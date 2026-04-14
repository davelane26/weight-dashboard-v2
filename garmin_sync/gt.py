import subprocess, sys
subprocess.run([sys.executable,"-m","pip","install","garth"],check=True)
import garth
from getpass import getpass
e=input("Email: ")
p=getpass("Password: ")
try:
    garth.login(e,p)
    print("AUTH OK")
    from datetime import date
    d=garth.connectapi(f"/usersummary-service/usersummary/daily",params={"calendarDate":date.today().isoformat()})
    print("DATA:",d)
except Exception as ex:
    print("FAIL:",ex)
