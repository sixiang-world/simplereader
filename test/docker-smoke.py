import os,subprocess,urllib.request,json
cfg=os.environ.copy()
def docker(*args):return subprocess.check_output(['docker',*args],env=cfg,text=True).strip()
cid=docker('run','--pull=never','-d','--rm','-p','127.0.0.1::80',os.environ.get('DOCKER_IMAGE', 'simplereader:latest'))
try:
 port=docker('port',cid,'80/tcp').split(':')[-1]
 for path in ['/', '/version.json','/client/lib/opencc/full.js','/client/src/modules/file/file-processor-worker.js']:
  for attempt in range(30):
   try:
    with urllib.request.urlopen('http://127.0.0.1:'+port+path,timeout=3) as r:
     data=r.read();assert r.status==200
     if path=='/':assert b'<html' in data
     elif path=='/version.json':assert json.loads(data)['version']==json.load(open('version.json'))['version']
     else:assert b'<html' not in data[:30]
    break
   except ConnectionError:
    if attempt==29:raise
 print('Caddy image: HTML, version, OpenCC and file Worker HTTP passed')
finally:docker('stop',cid)
