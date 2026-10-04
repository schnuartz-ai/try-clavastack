"""Generate only the platform call boundary; retain original SDK models/API."""
from pathlib import Path
import re
from prepare import ROOT, STAGE, DEPS

SDK = DEPS / 'bull_sdk/lib/src/rust'

def class_body(text, name):
    start = text.index('abstract class '+name)
    brace = text.index('{', start)
    depth = 1
    end = brace + 1
    while depth:
        if text[end] == '{': depth += 1
        elif text[end] == '}': depth -= 1
        end += 1
    return text[start:end]

def decode(typ, value):
    if typ.endswith('?'):
        return f'{value} == null ? null : ({decode(typ[:-1], value)})'
    if typ.startswith('List<'):
        return f'({value} as List).map((v) => {decode(typ[5:-1], "v")}).toList()'
    if typ in ['String', 'bool', 'int', 'double']: return f'{value} as {typ}'
    if typ in ['BigInt', 'PlatformInt64']: return f'BigInt.parse({value}.toString())'
    if typ == 'Uint8List': return f'Uint8List.fromList(({value} as List).cast<int>())'
    if typ == 'LiquidTransaction': return f'BrowserLiquidTransaction(Uint8List.fromList(({value} as List).cast<int>()))'
    return f'_decodeLwk{typ}({value})'

def encode(typ, value):
    if typ in ['BigInt', 'LiquidNetwork']: return value + ('.toString()' if typ == 'BigInt' else '.name')
    if typ == 'List<OutPoint>': return f"{value}.map((p) => {{'txid':p.txid, 'vout':p.vout}}).toList()"
    if typ == 'List<TxOutputSpec>': return f"{value}.map((p) => {{'address':p.address, 'satoshi':p.satoshi.toString(), 'assetId':p.assetId}}).toList()"
    return value

def generate():
    # Read pristine pinned SDK rather than an already-generated build overlay.
    source = ROOT / '.browser-work/bull-sdk/packages/bull_sdk/lib/src/rust'
    original = (source / 'frb_generated.dart').read_text()
    imports = [s for s in re.findall(r"import '[^']+';", original) if not any(v in s for v in ['frb_generated', 'dart:async', 'dart:convert'])]
    imports += ["import 'dart:convert';", "import 'dart:js_interop';", "import 'dart:typed_data';"]
    api = class_body(original, 'BullSdkApi').replace(' extends BaseApi', '')
    implementation = (ROOT / 'browser/bull/sdk_web.dart').read_text()
    implementation = re.sub(r'\bdecode(Descriptor|Address|SizeAndFees)\(', r'_decodeLwk\1(', implementation)
    wallet = (source / 'third_party/lwk/api/wallet.dart').read_text()
    methods = []
    for m in re.finditer(r'  (Future<[^\n]+>) (\w+)\((.*?)\);', wallet, re.S):
        ret, name, params = m.groups()
        if name == 'sync_': continue
        fields = re.findall(r'(?:required )?([\w<>?]+) (\w+)\s*,', params)
        args = ', '.join(f"'{key}':{encode(typ,key)}" for typ,key in fields)
        value = f"_invoke('{name}', {{{args}}})"
        body = decode(ret[7:-1], value)
        methods.append(f'  @override\n  {ret} {name}({params}) async => {body};')
    implementation = implementation.replace('/* WALLET METHODS */', '\n'.join(methods))
    transaction = (source / 'third_party/lwk/api/transaction.dart').read_text()
    for original_name, browser_name, operation, field in [
        ('LiquidTransaction', 'BrowserLiquidTransaction', 'liquidTransaction', 'txBytes'),
        ('PartiallySignedElementsTransaction', 'BrowserElementsPset', 'elementsPset', 'pset')]:
        body = class_body(transaction, original_name)
        methods = []
        for match in re.finditer(r'  ([\w<>?]+) (\w+)\((.*?)\);', body, re.S):
            ret, name, params = match.groups()
            if name == 'dispose' or name == 'noSuchMethod': continue
            fields = re.findall(r'(?:required )?([\w<>?]+) (\w+)\s*[,}]', params)
            args = ', '.join(f"'{key}':{encode(typ,key)}" for typ,key in fields)
            value = f"_invoke('{name}', {{{args}}})"
            methods.append(f'  @override\n  {ret} {name}({params}) => {decode(ret,value)};')
        datatype = 'Uint8List' if field == 'txBytes' else 'String'
        implementation += f'''
class {browser_name} extends BrowserOpaque implements {original_name} {{
  final {datatype} payload;
  {browser_name}(this.payload);
  dynamic _invoke(String method, Map<String,dynamic> args) {{
    check();
    return _call('{operation}', {{'{field}':payload, 'method':method, 'args':args}});
  }}
  {chr(10).join(methods)}
}}
'''
    models = []
    for path in ['types', 'descriptor', 'transaction']:
        text = (source / f'third_party/lwk/api/{path}.dart').read_text()
        for m in re.finditer(r'^class (\w+) \{(.*?)\n  const \1\(', text, re.M|re.S):
            name, fields = m.groups()
            args = ',\n'.join(f"  {key}: {decode(typ, 'v['+repr(key)+']')}" for typ,key in re.findall(r'final ([\w<>?]+) (\w+);', fields))
            models.append(f'{name} _decodeLwk{name}(dynamic v) => {name}(\n{args}\n);')
    (SDK / 'frb_generated.dart').write_text('// Browser platform boundary for the pinned native API.\n'+'\n'.join(imports)+'\n'+api+'\n'+implementation+'\n'+'\n'.join(models))
    onion = DEPS / 'onion/lib/src/rust/frb_generated.dart'
    original_onion = onion.read_text()
    if 'abstract class OnionCoreApi extends BaseApi' in original_onion:
        imports = [s for s in re.findall(r"import '[^']+';", original_onion) if 'frb_generated' not in s]
        api = class_body(original_onion, 'OnionCoreApi').replace(' extends BaseApi', '')
        onion.write_text('\n'.join(imports)+'\n'+api+'''
class OnionCore {
  OnionCore._();
  static final instance = OnionCore._();
  final OnionCoreApi api = BrowserOnionApi();
  // Register the platform boundary. No Tor connection or ready state is implied.
  static Future<void> init() async {}
  static void dispose() {}
}
class BrowserOnionApi extends OnionCoreApi {
  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnsupportedError('Embedded Tor requires native TCP and is unavailable in a browser');
}
''')
    print('Prepared original SDK type-safe LWK web call boundary')

if __name__ == '__main__': generate()
