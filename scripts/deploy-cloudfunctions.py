import sys
import os
import json
import time
import zipfile
import io
import base64
import hmac
import hashlib
import urllib.parse
import urllib.request

REGION = 'ap-shanghai'
ENV_ID = 'chenzezhineng-d9g5u1dt34eb52837'
NAMESPACE = ENV_ID

def sha256(data):
    if isinstance(data, str):
        data = data.encode('utf-8')
    return hashlib.sha256(data).digest()

def hmac_sha256(key, data):
    if isinstance(key, str):
        key = key.encode('utf-8')
    if isinstance(data, str):
        data = data.encode('utf-8')
    return hmac.new(key, data, hashlib.sha256).digest()

def sign_request(secret_id, secret_key, action, params):
    algorithm = 'TC3-HMAC-SHA256'
    timestamp = int(time.time())
    date = time.strftime('%Y-%m-%d', time.gmtime(timestamp))
    
    service = 'scf'
    host = f'{service}.{REGION}.tencentcloudapi.com'
    endpoint = f'https://{host}'
    uri = '/'
    
    params['Action'] = action
    params['Version'] = '2018-04-16'
    params['Region'] = REGION
    params['Timestamp'] = timestamp
    params['Nonce'] = timestamp + 1
    params['SecretId'] = secret_id
    
    sorted_params = sorted(params.items())
    query_string = '&'.join(f'{k}={urllib.parse.quote(str(v), safe="")}' for k, v in sorted_params)
    
    canonical_uri = uri
    canonical_querystring = query_string
    canonical_headers = f'content-type:application/json\nhost:{host}\n'
    signed_headers = 'content-type;host'
    
    payload = json.dumps(params, separators=(',', ':'))
    hashed_request_payload = sha256(payload)
    
    canonical_request = '\n'.join([
        'POST',
        canonical_uri,
        canonical_querystring,
        canonical_headers,
        signed_headers,
        hashed_request_payload.hex()
    ])
    
    credential_scope = f'{date}/{service}/tc3_request'
    hashed_canonical_request = sha256(canonical_request)
    
    string_to_sign = '\n'.join([
        algorithm,
        str(timestamp),
        credential_scope,
        hashed_canonical_request.hex()
    ])
    
    secret_date = hmac_sha256(f'TC3{secret_key}', date)
    secret_service = hmac_sha256(secret_date, service)
    secret_signing = hmac_sha256(secret_service, 'tc3_request')
    signature = hmac_sha256(secret_signing, string_to_sign).hex()
    
    authorization = f'{algorithm} Credential={secret_id}/{credential_scope}, SignedHeaders={signed_headers}, Signature={signature}'
    
    headers = {
        'Content-Type': 'application/json',
        'Authorization': authorization,
        'Host': host,
        'X-TC-Action': action.lower(),
        'X-TC-Version': '2018-04-16',
        'X-TC-Region': REGION
    }
    
    return endpoint, headers, payload

def make_request(secret_id, secret_key, action, params):
    endpoint, headers, payload = sign_request(secret_id, secret_key, action, params)
    req = urllib.request.Request(endpoint, data=payload.encode('utf-8'), headers=headers, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except Exception as e:
        print(f'  请求失败: {e}')
        return None

def zip_folder(folder_path):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
        for root, dirs, files in os.walk(folder_path):
            for file in files:
                file_path = os.path.join(root, file)
                arcname = os.path.relpath(file_path, folder_path)
                zf.write(file_path, arcname)
    buffer.seek(0)
    return buffer.read()

def deploy_function(secret_id, secret_key, func_name, folder_path):
    print(f'\n=== 部署云函数: {func_name} ===')
    
    zip_data = zip_folder(folder_path)
    zip_base64 = base64.b64encode(zip_data).decode('utf-8')
    zip_size = len(zip_data) / 1024
    print(f'  压缩包大小: {zip_size:.2f} KB')
    
    params = {
        'FunctionName': func_name,
        'Namespace': NAMESPACE,
        'Code': {
            'ZipFile': zip_base64
        },
        'Handler': 'index.main'
    }
    
    print('  正在上传...')
    result = make_request(secret_id, secret_key, 'UpdateFunctionCode', params)
    
    if result and result.get('Response', {}).get('RequestId'):
        print(f'  ✅ 部署成功! RequestId: {result["Response"]["RequestId"]}')
        return True
    else:
        print(f'  ❌ 部署失败: {json.dumps(result, indent=2, ensure_ascii=False)}')
        return False

def list_functions(secret_id, secret_key):
    print('\n=== 查询已部署云函数 ===')
    result = make_request(secret_id, secret_key, 'ListFunctions', {
        'Namespace': NAMESPACE,
        'Limit': 20
    })
    if result and result.get('Response'):
        funcs = result['Response'].get('Functions', [])
        print(f'  共 {len(funcs)} 个函数:')
        for f in funcs:
            print(f'    - {f.get("FunctionName")}')
    return result

def main():
    if len(sys.argv) != 3:
        print('用法: python deploy-cloudfunctions.py <SecretId> <SecretKey>')
        print()
        print('请从腾讯云控制台获取 API 密钥:')
        print('https://console.cloud.tencent.com/cam/capi')
        sys.exit(1)
    
    secret_id = sys.argv[1]
    secret_key = sys.argv[2]
    
    functions = [
        ('service-price-manager', 'cloudfunctions/service-price-manager'),
        ('products-manager', 'cloudfunctions/products-manager'),
        ('quotations-manager', 'cloudfunctions/quotations-manager'),
        ('export-quotation', 'cloudfunctions/export-quotation'),
    ]
    
    list_functions(secret_id, secret_key)
    
    print('\n===== 开始部署 =====')
    success_count = 0
    for func_name, folder in functions:
        if os.path.isdir(folder):
            if deploy_function(secret_id, secret_key, func_name, folder):
                success_count += 1
        else:
            print(f'\n⚠️ 目录不存在: {folder}')
    
    print(f'\n===== 部署完成 =====')
    print(f'成功: {success_count}/{len(functions)}')
    
    if success_count < len(functions):
        sys.exit(1)

if __name__ == '__main__':
    main()
