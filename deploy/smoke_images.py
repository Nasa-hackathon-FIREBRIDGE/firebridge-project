"""Run production images against isolated fixture services, never production."""
import argparse
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import tempfile

root=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--revision',required=True);a=p.parse_args()
checks=['docker','compose','-p','firebridge-webapp-checks','-f',str(root/'deploy/compose.checks.yaml')]
def execute(args,**kw):
    r=subprocess.run(args,text=True,capture_output=True,**kw)
    if r.returncode:raise RuntimeError(r.stderr[-3000:]+r.stdout[-2000:])
    return r.stdout.strip()
db=checks+['exec','-T','db','psql','-X','-U','firebridge','-d','firebridge_phase1_test','-v','ON_ERROR_STOP=1','-At']
if execute(db,input='SELECT current_database();')!='firebridge_phase1_test':raise ValueError('Unsafe smoke-test database.')
password=secrets.token_hex(24)
sql=f"""DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='firebridge_webapp') THEN CREATE ROLE firebridge_webapp LOGIN; END IF; END $$;
ALTER ROLE firebridge_webapp PASSWORD '{password}';
"""+(root/'deploy/runtime_grants.sql').read_text()+"""
INSERT INTO firebridge.data_releases(id,name,status,stream,code_version,config,config_sha256,manifest_uri,dataset_kind,scope_key,observation_cutoff,published_at)
VALUES('facade00-0000-4000-8000-000000000001','synthetic-container-smoke-only','published','experiment','fixture','{}',repeat('0',64),'fixture-only','satellite','container-smoke',now(),now()) ON CONFLICT(id) DO NOTHING;
INSERT INTO firebridge.release_aliases(alias,scope_key,release_id,generation,updated_at)
VALUES('best_available','container-smoke','facade00-0000-4000-8000-000000000001',1,now()) ON CONFLICT(alias,scope_key) DO NOTHING;
"""
execute(db,input=sql)
with tempfile.TemporaryDirectory(prefix='firebridge-image-smoke-') as temporary:
    directory=Path(temporary)
    shutil.copy2(root/'deploy/compose.production.yaml',directory/'compose.yaml')
    shutil.copy2(root/'deploy/Caddyfile',directory/'Caddyfile')
    redis_password=secrets.token_hex(24)
    (directory/'redis.conf').write_text('bind 0.0.0.0\nprotected-mode yes\nrequirepass '+redis_password+'\nappendonly yes\nmaxmemory 96mb\nmaxmemory-policy noeviction\n')
    # The temp parent is private; the individual bind mount must be readable by redis.
    (directory/'redis.conf').chmod(0o644)
    env={
      'DATABASE_URL':f'postgresql://firebridge_webapp:{password}@db:5432/firebridge_phase1_test?schema=firebridge&connection_limit=4',
      'REDIS_URL':f'redis://:{redis_password}@redis:6379/0','NODE_ENV':'production','PORT':'3000','API_HOST':'0.0.0.0',
      'CURSOR_SECRET':secrets.token_hex(32),'PAGINATION_SECRET':secrets.token_hex(32),'DEFAULT_SCOPE_KEY':'container-smoke',
      'CORS_ORIGINS':'https://astramind.solutions','EXPORT_STORAGE_DIR':'/app/.data/exports','ANALYSIS_WORKER_CONCURRENCY':'1',
      'EXPORT_WORKER_CONCURRENCY':'1','RECOVERY_ENABLED':'false'}
    (directory/'runtime.env').write_text('\n'.join(k+'='+v for k,v in env.items())+'\n');(directory/'runtime.env').chmod(0o600)
    (directory/'.env').write_text('\n'.join(k.upper()+'_IMAGE=firebridge-webapp-'+k+':'+a.revision for k in ('api','worker','frontend'))+'\n')
    (directory/'override.yaml').write_text("""services:
  api:
    ports: !reset []
networks:
  data:
    name: firebridge-webapp-checks_default
""")
    stack=['docker','compose','-p','firebridge-webapp-smoke','-f',str(directory/'compose.yaml'),'-f',str(directory/'override.yaml')]
    try:
      execute(stack+['config','--quiet'])
      execute(['docker','volume','create','firebridge-webapp-smoke_redis_data'])
      execute(['docker','run','--rm','--user','0:0','--entrypoint','sh','-v','firebridge-webapp-smoke_redis_data:/data',
        'redis:7-alpine@sha256:c5d34a98396a4775e223c74e929162c35c5a2182901ba26b50ade939941ce14b','-c','chown 999:999 /data'])
      execute(stack+['up','-d','--wait','--wait-timeout','150','api','worker','frontend','redis'],timeout=200)
      execute(stack+['exec','-T','api','node','-e',"fetch('http://127.0.0.1:3000/api/v1/catalog').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"])
      verify="""const {Pool}=require('pg');const p=new Pool({connectionString:process.env.DATABASE_URL,max:1});p.query(\"SELECT has_table_privilege(current_user,'firebridge.detections','INSERT') AS can_write_raw,has_table_privilege(current_user,'firebridge.areas','INSERT') AS can_create_area\").then(r=>{if(r.rows[0].can_write_raw||!r.rows[0].can_create_area)process.exitCode=1}).finally(()=>p.end());"""
      execute(stack+['exec','-T','api','node','-e',verify])
      print(json.dumps({'containers':'healthy','catalogue':'servable','runtime_role':'limited','synthetic_data':'isolated test database only'}))
    except Exception:
      # Strip generated values before returning diagnostics to CI logs.
      logs=execute(stack+['logs','--tail=60'])
      for value in env.values():
        if len(value)>15:logs=logs.replace(value,'[redacted]')
      logs=logs.replace(password,'[redacted]').replace(redis_password,'[redacted]')
      print(logs[-7000:]);raise
    finally:
      execute(stack+['down','-v','--remove-orphans'])
