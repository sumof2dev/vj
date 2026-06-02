## Update Pi
./push_update.sh sumof2@192.168.1.90

## Run Audit (Fetch Automatically from Pi)
./venv/bin/python offline_audit_engine.py --host 192.168.1.90:8000 --session audit1

## Run Audit (On Locally Extracted Directory)
./venv/bin/python offline_audit_engine.py --local-dir ./recordings/audit1 --host 192.168.1.90:8000

## Copy Recording Session from Pi via SCP
scp -r sumof2@192.168.1.90:~/projects/RAVEBOX/recordings/<session_name> ./recordings/
