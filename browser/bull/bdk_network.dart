@JS('bullBdkScan')
external JSPromise<JSString> _browserBdkScan(JSString wallet, JSNumber stopGap);

Future<Update> browserFullScan({
  required Wallet wallet,
  required int stopGap,
}) async {
  final ownedClone = Wallet.lower(wallet);
  final result = (await _browserBdkScan(
    ownedClone.address.toString().toJS,
    stopGap.toJS,
  ).toDart).toDart;
  return Update.lift(Pointer<Void>.fromAddress(int.parse(result)));
}
