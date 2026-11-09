#!/usr/bin/python3
"""Restricted image-only deployment protocol; installed root-owned on the VPS."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys
from datetime import datetime, timezone

ROOT = Path('/opt/firebridge/webapp')
REPO = 'https://github.com/Nasa-hackathon-FIREBRIDGE/firebridge-project'
MAX_BYTES = 3 * 1024**3
def run(*command, timeout=300):
    r = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, timeout=timeout)
    if r.returncode:
        raise RuntimeError('Deployment step failed; inspect the private server log.')
    return r.stdout.strip()
def tags(sha):
    return {key: f'firebridge-webapp-{key}:{sha}' for key in ('api','worker','frontend')}
def verify(sha):
    for name, tag in tags(sha).items():
        info = json.loads(run('docker','image','inspect',tag))[0]
        labels = info['Config'].get('Labels') or {}
        if labels.get('org.opencontainers.image.source') != REPO or labels.get('org.opencontainers.image.revision') != sha:
            raise ValueError('Image source/revision label mismatch: ' + name)
def activate(sha):
    verify(sha)
    env = ROOT/'.env'
    original = env.read_text() if env.exists() else None
    # Database changes are administrator-reviewed, outside this image-only protocol.
    backup = ROOT/'backups'; backup.mkdir(mode=0o700,exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    dump = backup/(stamp+'-pre-webapp.dump')
    with dump.open('wb') as out:
        subprocess.run(['sh','/opt/firebridge/current/scripts/stack.sh','exec','-T','db','pg_dump','-U','firebridge','-d','firebridge','-Fc'],stdout=out,stderr=subprocess.PIPE,check=True,timeout=300)
    dump.chmod(0o600)
    selected = tags(sha)
    content = '\n'.join(f'{key.upper()}_IMAGE={value}' for key,value in selected.items())+'\n'
    temporary = env.with_suffix('.next');temporary.write_text(content);temporary.chmod(0o600);temporary.replace(env)
    try:
        run('docker','compose','config','--quiet')
        run('docker','compose','up','-d','--wait','--wait-timeout','180',timeout=240)
        # Readiness must include real PostgreSQL, Redis and a published catalogue.
        run('docker','compose','exec','-T','api','node','-e',"fetch('http://127.0.0.1:3000/api/v1/health/ready').then(async r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))")
    except Exception:
        if original:
            env.write_text(original);env.chmod(0o600)
            run('docker','compose','up','-d','--wait','--wait-timeout','180',timeout=240)
        raise
    receipt={'state':'healthy','revision':sha,'deployed_at':datetime.now(timezone.utc).isoformat(),'images':selected,'domain':'astramind.solutions'}
    (ROOT/'deployment.json').write_text(json.dumps(receipt,indent=2)+'\n')
    print(json.dumps(receipt))
def main():
    if os.geteuid()!=0:raise RuntimeError('Root-owned gateway must run through its restricted sudo rule.')
    args=shlex.split(os.environ.get('SSH_ORIGINAL_COMMAND',''))
    if args==['status']:
        receipt=ROOT/'deployment.json';print(receipt.read_text() if receipt.exists() else '{"state":"not_deployed"}');return
    if len(args) not in (2,3) or not re.fullmatch(r'[a-f0-9]{40}',args[1]):raise ValueError('Invalid deployment command/revision.')
    mode,sha=args[:2]
    ROOT.mkdir(mode=0o700,parents=True,exist_ok=True)
    with (ROOT/'deployment.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        if mode=='images' and len(args)==3 and re.fullmatch(r'[a-f0-9]{64}',args[2]):
            archive=ROOT/(sha+'.images.tar.gz.partial')
            digest=hashlib.sha256();size=0
            try:
                with archive.open('wb') as out:
                    archive.chmod(0o600)
                    while True:
                        chunk=sys.stdin.buffer.read(1024**2)
                        if not chunk:break
                        size+=len(chunk)
                        if size>MAX_BYTES:raise ValueError('Image transfer exceeds the allowed size.')
                        digest.update(chunk);out.write(chunk)
                if digest.hexdigest()!=args[2]:raise ValueError('Transferred archive checksum mismatch.')
                run('docker','load','--input',str(archive),timeout=600)
                verify(sha)
                print(json.dumps({'images':'verified','revision':sha,'compressed_bytes':size}))
            finally:
                archive.unlink(missing_ok=True)
        elif mode in ('activate','rollback') and len(args)==2:
            logs=ROOT/'logs';logs.mkdir(mode=0o700,exist_ok=True)
            path=logs/(sha+'.log')
            # Operational commands never print environment values or passwords.
            with path.open('a') as log:
                log.write(datetime.now(timezone.utc).isoformat()+' '+mode+'\n')
                try:activate(sha)
                except Exception as error:
                    log.write(type(error).__name__+': '+str(error)+'\n');raise
        else:raise ValueError('Unsupported deployment command.')
if __name__=='__main__':
    try:main()
    except Exception as error:
        print('Webapp deployment rejected or failed: '+str(error),file=sys.stderr);sys.exit(1)
