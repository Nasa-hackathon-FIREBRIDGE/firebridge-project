"""Administrator-only provisioning; never prints application secrets."""
import argparse
import json
import os
from pathlib import Path
import pwd
import re
import secrets
import shutil
import subprocess

ROOT=Path('/opt/firebridge/webapp')
INSTALL=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--ci-public-key',type=Path,required=True)
a=p.parse_args()
def run(*args, text=None):
    result=subprocess.run(args,input=text,capture_output=True,text=True,check=True)
    return result.stdout.strip()
if os.geteuid()!=0:raise SystemExit('Run in an administrator root session.')
ROOT.mkdir(mode=0o700,parents=True,exist_ok=True);ROOT.chmod(0o700)
private=ROOT/'private-config.json'
if private.exists():config=json.loads(private.read_text())
else:
    config={k:secrets.token_hex(32) for k in ('database_password','redis_password','cursor_secret','pagination_secret')}
    private.write_text(json.dumps(config));private.chmod(0o600)
password=config['database_password']
sql=f"""DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='firebridge_webapp') THEN CREATE ROLE firebridge_webapp LOGIN; END IF; END $$;
ALTER ROLE firebridge_webapp PASSWORD '{password}';
"""+(INSTALL/'deploy/runtime_grants.sql').read_text()
run('sh','/opt/firebridge/current/scripts/stack.sh','exec','-T','db','psql','-X','-U','firebridge','-d','firebridge','-v','ON_ERROR_STOP=1',text=sql)
runtime={
 'NODE_ENV':'production','PORT':'3000','API_HOST':'0.0.0.0','LOG_LEVEL':'info',
 'DATABASE_URL':f'postgresql://firebridge_webapp:{password}@db:5432/firebridge?schema=public&connection_limit=4',
 'REDIS_URL':f"redis://:{config['redis_password']}@firebridge-webapp-redis:6379/0",
 'CURSOR_SECRET':config['cursor_secret'],'PAGINATION_SECRET':config['pagination_secret'],
 'CORS_ORIGINS':'https://ogote.com,https://astramind.solutions','DEFAULT_SCOPE_KEY':'global',
 'INGESTION_ADMIN_TOKEN':'','ANALYSIS_WORKER_CONCURRENCY':'1','EXPORT_WORKER_CONCURRENCY':'1',
 'RECOVERY_ENABLED':'false','EXPORT_STORAGE_DIR':'/app/.data/exports',
 'EXPORT_MAX_ROWS':'100000','EXPORT_MAX_BYTES':'33554432','EXPORT_MAX_ACTIVE':'1','EXPORT_MAX_PER_HOUR':'5',
 'EXPORT_MAX_DURATION_SECONDS':'120','TILE_REQUESTS_PER_MINUTE':'120',
}
env=ROOT/'runtime.env';env.write_text('\n'.join(k+'='+v for k,v in runtime.items())+'\n');env.chmod(0o600)
redis=ROOT/'redis.conf'
redis.write_text('bind 0.0.0.0\nprotected-mode yes\nrequirepass '+config['redis_password']+'\nappendonly yes\nappendfsync everysec\nmaxmemory 96mb\nmaxmemory-policy noeviction\n')
os.chown(redis,999,999);redis.chmod(0o400)
shutil.copy2(INSTALL/'deploy/compose.production.yaml',ROOT/'compose.yaml')
shutil.copy2(INSTALL/'deploy/nginx.proxy.conf',ROOT/'nginx.proxy.conf')
helper=Path('/usr/local/sbin/firebridge-webapp-gateway');shutil.copy2(INSTALL/'deploy/webapp_gateway.py',helper);helper.chmod(0o755);os.chown(helper,0,0)
account='firebridge-webapp-deploy'
try:entry=pwd.getpwnam(account)
except KeyError:
    run('useradd','--system','--create-home','--home-dir','/var/lib/'+account,'--shell','/bin/bash',account)
    entry=pwd.getpwnam(account)
directory=Path(entry.pw_dir)/'.ssh';directory.mkdir(mode=0o700,exist_ok=True);directory.chmod(0o700);os.chown(directory,entry.pw_uid,entry.pw_gid)
public=a.ci_public_key.read_text().strip()
if not re.fullmatch(r'ssh-ed25519 [A-Za-z0-9+/=]+(?: [^\r\n]+)?',public):raise ValueError('Invalid CI public key.')
authorized=directory/'authorized_keys';authorized.write_text('restrict,command="/usr/bin/sudo -n /usr/local/sbin/firebridge-webapp-gateway" '+public+'\n');authorized.chmod(0o600);os.chown(authorized,entry.pw_uid,entry.pw_gid)
rule=Path('/etc/sudoers.d/firebridge-webapp-cd')
rule.write_text('Defaults:'+account+' env_keep += "SSH_ORIGINAL_COMMAND"\n'+account+' ALL=(root) NOPASSWD: /usr/local/sbin/firebridge-webapp-gateway ""\n');rule.chmod(0o440)
run('visudo','-cf',str(rule))
ssh=Path('/etc/ssh/sshd_config.d/00-firebridge.conf');original=ssh.read_text()
match=re.search(r'^AllowUsers (.+)$',original,re.M)
if not match:raise ValueError('Existing SSH AllowUsers needs administrator review.')
allowed=match[1].split()
if account not in allowed:
    allowed.append(account)
    updated=original[:match.start()]+'AllowUsers '+' '.join(allowed)+original[match.end():]
    ssh.write_text(updated)
    try:run('/usr/sbin/sshd','-t')
    except Exception:ssh.write_text(original);raise
    run('systemctl','reload','ssh')
for volume,uid in (('firebridge-webapp_redis_data',999),('firebridge-webapp_exports',1000)):
    run('docker','volume','create',volume)
    run('docker','run','--rm','--user','0:0','--entrypoint','sh','-v',volume+':/data',
      'redis:7-alpine@sha256:c5d34a98396a4775e223c74e929162c35c5a2182901ba26b50ade939941ce14b','-c',f'chown {uid}:{uid} /data')
run('ufw','allow','80/tcp','comment','FIREBRIDGE HTTP')
run('ufw','allow','443/tcp','comment','FIREBRIDGE HTTPS')
print(json.dumps({'webapp':'provisioned','runtime_role':'firebridge_webapp','secrets':'private files only','deploy_account':account,'domain':'ogote.com','existing_data_services_restarted':False}))
