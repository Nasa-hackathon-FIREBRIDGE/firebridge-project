"""Apply only additive app migrations to a verified existing data-platform schema."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess

root = Path(__file__).resolve().parents[1]
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--stack', type=Path)
p.add_argument('--compose', type=Path)
p.add_argument('--database', default='firebridge')
p.add_argument('--fixture-pipeline', type=Path)
a = p.parse_args()
if bool(a.stack) == bool(a.compose):
    raise SystemExit('Select exactly one stack or isolated compose file.')
prefix = ['sh', str(a.stack)] if a.stack else ['docker', 'compose', '-p', 'firebridge-webapp-checks', '-f', str(a.compose)]
def sql(body, result=False):
    r = subprocess.run(prefix + ['exec','-T','db','psql','-X','-U','firebridge','-d',a.database,'-v','ON_ERROR_STOP=1','-At'], input=body, text=True, capture_output=True)
    if r.returncode:
        raise RuntimeError('Database preparation failed: ' + r.stderr[-1800:])
    return r.stdout.strip() if result else None
expected = json.loads((root/'deploy/pipeline-schema.json').read_text())['migrations']
if a.fixture_pipeline:
    if not a.compose or a.database != 'firebridge_phase1_test':
        raise SystemExit('Fixture initialization is restricted to the isolated test database.')
    sql('CREATE TABLE public.firebridge_migrations(name text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now());')
    for name, checksum in expected.items():
        body = (a.fixture_pipeline/'src/firebridge/migrations'/name).read_text()
        if hashlib.sha256(body.encode()).hexdigest() != checksum:
            raise ValueError('Pinned pipeline schema checksum mismatch: ' + name)
        sql("BEGIN;\n" + body + "\nINSERT INTO public.firebridge_migrations(name,sha256) VALUES ('" + name + "','" + checksum + "');\nCOMMIT;")
actual = json.loads(sql('SELECT json_object_agg(name,sha256) FROM public.firebridge_migrations;', True))
if any(actual.get(name) != checksum for name, checksum in expected.items()):
    raise ValueError('Existing data-platform schema does not match the reviewed migration baseline.')
statements = ["BEGIN; SET LOCAL lock_timeout='5s'; SELECT pg_advisory_xact_lock(hashtextextended('firebridge-webapp:migrate',0));",
    'CREATE TABLE IF NOT EXISTS public.firebridge_webapp_migrations(name text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now());']
names = ['20261101010000_analysis_request_keys','20261101020000_explanation_request_keys','20261101030000_phase4_serving_indexes','20261104000000_public_requests']
for name in names:
    body = (root/'firebridge-backend/packages/database/prisma/migrations'/name/'migration.sql').read_text()
    checksum = hashlib.sha256(body.encode()).hexdigest()
    executable = re.sub(r'(?m)^(?:BEGIN|COMMIT);\s*$', '', body)
    statements.append(f"""DO $webapp$
BEGIN
  IF EXISTS(SELECT 1 FROM public.firebridge_webapp_migrations WHERE name='{name}' AND sha256<>'{checksum}') THEN
    RAISE EXCEPTION 'Applied webapp migration checksum changed';
  ELSIF NOT EXISTS(SELECT 1 FROM public.firebridge_webapp_migrations WHERE name='{name}') THEN
    EXECUTE $change${executable}$change$;
    INSERT INTO public.firebridge_webapp_migrations(name,sha256) VALUES('{name}','{checksum}');
  END IF;
END $webapp$;""")
statements.append('COMMIT;')
sql('\n'.join(statements))
print(json.dumps({'pipeline_schema':'verified','application_migrations':len(names),'database':a.database}))
