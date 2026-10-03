"""Transport regression tests; no private wallet data or network required."""
import hashlib
import io
import json
import unittest
from unittest.mock import patch

import electrum_relay as relay


class RelayTests(unittest.TestCase):
    def body(self, **values):
        return {"host": "electrum.blockstream.info", "port": 50002,
                "ssl": True, "method": "server.ping", "params": [], **values}

    def test_rejects_unapproved_destinations_and_methods(self):
        for values in ({"host": "127.0.0.1"}, {"host": []}, {"port": 8332},
                       {"ssl": False}, {"method": "walletpassphrase"}, {"method": []},
                       {"params": {}}, {"parameter_batch": [[]]},
                       {"method": "blockchain.scripthash.subscribe", "scripthashes": ["../"]}):
            with self.subTest(values=values), self.assertRaises(ValueError):
                relay.query(self.body(**values))

    def test_status_uses_history_without_retained_subscription(self):
        history = [{"tx_hash": "a" * 64, "height": 42}]
        with patch.object(relay, "_call", return_value={"result": history}) as call:
            result = relay.query(self.body(method="blockchain.scripthash.subscribe", params=["b" * 64]))
        call.assert_called_once_with(("electrum.blockstream.info", 50002), "blockchain.scripthash.get_history", ["b" * 64])
        self.assertEqual(result["result"], hashlib.sha256(("a" * 64 + ":42:").encode()).hexdigest())
        self.assertIsNone(relay._status([]))

    def test_script_batch_contains_actual_history_and_status(self):
        history = [{"tx_hash": "a" * 64, "height": 0}]
        with patch.object(relay, "_call_many", return_value=[{"result": history}, {"result": []}]) as call:
            result = relay.query(self.body(method="blockchain.scripthash.subscribe",
                scripthashes=["b" * 64, "c" * 64], include_history=True))
        self.assertEqual(call.call_args.args[1], "blockchain.scripthash.get_history")
        self.assertEqual(result["result"][0]["history"], history)
        self.assertEqual(result["result"][1], {"history": [], "status": None})

    def test_read_batch_and_rpc_error(self):
        with patch.object(relay, "_call_many", return_value=[{"result": "raw"}]):
            result = relay.query(self.body(method="blockchain.transaction.get", parameter_batch=[["a" * 64, False]]))
        self.assertEqual(result, {"result": ["raw"], "error": None})
        with patch.object(relay, "_call", return_value={"error": {"code": -1, "message": "unknown"}}):
            self.assertEqual(relay.query(self.body())["error"]["code"], -1)

    def test_reads_retry_once_broadcast_never_retries(self):
        with patch.object(relay, "_call", side_effect=[OSError("closed"), {"result": None}]) as call:
            self.assertIsNone(relay.query(self.body())["result"])
            self.assertEqual(call.call_count, 2)
        with patch.object(relay, "_call", side_effect=OSError("closed")) as call:
            with self.assertRaises(OSError):
                relay.query(self.body(method="blockchain.transaction.broadcast", params=["00"]))
            self.assertEqual(call.call_count, 1)

    def test_pipelined_responses_reordered_by_id(self):
        stream = io.BytesIO(b'{"id":2,"result":"two"}\n{"id":1,"result":"one"}\n')
        class Socket:
            def sendall(self, payload):
                self.payload = payload
        connection = Socket()
        with patch.object(relay, "_connection", return_value=(connection, stream)):
            result = relay._call_many(("electrum.blockstream.info", 50002), "server.ping", [[], []])
        self.assertEqual([item["result"] for item in result], ["one", "two"])
        self.assertEqual(len(connection.payload.splitlines()), 2)

    def test_empty_and_oversized_responses_fail(self):
        for stream in (io.BytesIO(), io.BytesIO(b"x" * 2_000_001)):
            with self.assertRaises(RuntimeError):
                relay._read(stream, 1)

    def test_testnet_has_its_own_connection_and_allowlisted_port(self):
        with patch.object(relay, "_call", return_value={"result": None}) as call:
            relay.query(self.body(port=60002))
        call.assert_called_once_with(("electrum.blockstream.info", 60002), "server.ping", [])
        self.assertIn(("electrum.blockstream.info", 50002), relay._locks)
        self.assertIn(("electrum.blockstream.info", 60002), relay._locks)
        self.assertIsNot(relay._locks[("electrum.blockstream.info", 50002)], relay._locks[("electrum.blockstream.info", 60002)])
        with self.assertRaises(ValueError):
            relay.query(self.body(host="electrum.emzy.de", port=60002))


if __name__ == "__main__":
    unittest.main()
