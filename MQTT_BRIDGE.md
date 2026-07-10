# ⚖️ MQTT Bridge — Setup & Troubleshooting

How weight readings get from the scale to the dashboard, and how to fix the
pipeline when it stops.

```
Bluetooth scale
      ↓  (Bluetooth)
openScale app on phone
      ↓  (MQTT over home WiFi)
Mosquitto broker on home PC (port 1883)
      ↓
mqtt_bridge.py  (auto-started at logon)
      ↓
data.json  →  push to davelane26/Weight-tracker  →  GitHub Pages
      ↓
Dashboard polls https://davelane26.github.io/Weight-tracker/data.json every 30s
```

**Where things live (home PC, user `djtwo`):**

| Thing | Location |
|---|---|
| Bridge script | `C:\Users\djtwo\Downloads\weight-tracker\mqtt_bridge.py` |
| Autostart setup | `C:\Users\djtwo\Downloads\weight-tracker\SETUP_MQTT_AUTOSTART.bat` |
| Python | `C:\Users\djtwo\AppData\Local\Python\pythoncore-3.14-64\python.exe` |
| Broker | Mosquitto Windows service, port 1883 |
| Scheduled task | `WeightTrackerMQTTBridge` (runs at logon) |

The bridge is **not** in this repo or in Weight-tracker's working tree — it
lives only on the home PC. If that folder ever disappears, this doc is the
map back.

---

## First-time / re-setup

1. Run `SETUP_MQTT_AUTOSTART.bat` **once as Administrator**. It:
   - sets the Mosquitto service to start automatically on boot
   - creates the `WeightTrackerMQTTBridge` scheduled task (launches the
     bridge at every logon)
   - starts the bridge immediately in a minimized window

2. Point openScale at the PC. In openScale's MQTT settings the broker host
   must be the PC's **LAN IP** (find it with `ipconfig` → IPv4 address under
   the WiFi adapter), port `1883`. `localhost` only works from the PC itself.

   ⚠️ **The PC's IP is dynamic** — if the router hands it a new address, the
   phone keeps publishing into the void and weigh-ins silently stop. Pin it:
   - **Preferred — DHCP reservation:** get the adapter's MAC with
     `getmac /v`, then in the router admin page (DHCP → Address Reservation
     / Static Lease) bind that MAC to the current IP. Nothing on the PC or
     phone changes afterward.
   - **Fallback — static IP on the PC:** Windows Settings → Network &
     Internet → adapter → IP assignment → Manual. Riskier (can conflict
     with the DHCP pool); prefer the reservation.

3. Let the phone reach the broker — two things commonly block it:
   - **Mosquitto 2.x refuses remote connections by default.** The config
     (`C:\Program Files\mosquitto\mosquitto.conf`) needs:

     ```
     listener 1883
     allow_anonymous true
     ```

     then restart it: `net stop mosquitto && net start mosquitto`
   - **Windows Firewall** must allow inbound 1883:

     ```
     netsh advfirewall firewall add rule name="Mosquitto MQTT" dir=in action=allow protocol=TCP localport=1883
     ```

---

## When the pipeline is dead — checklist

Work top-down; each step isolates one link.

1. **Is Mosquitto running?**
   `sc query mosquitto` — if stopped: `net start mosquitto`

2. **Is the bridge running?**
   `schtasks /query /tn WeightTrackerMQTTBridge /fo LIST` and look for the
   python process. Restart with `schtasks /run /tn WeightTrackerMQTTBridge`.
   The bridge auto-reconnects (retries every 10s if the broker is down), so
   once started it should stay up.

3. **Do messages reach the broker?** On the PC:
   `"C:\Program Files\mosquitto\mosquitto_sub.exe" -h localhost -t "#" -v`
   then trigger a reading from the phone. Nothing arriving = phone-side
   problem: the PC's LAN IP changed and openScale is publishing to the old
   one (compare `ipconfig` with the host set in openScale — and pin the IP
   per the setup section), firewall, or the `listener`/`allow_anonymous`
   config above.

4. **Does the bridge push?** Watch the bridge window output after a reading,
   then confirm `data.json` updated:
   https://github.com/davelane26/Weight-tracker/commits/main
   A reading that reaches the bridge but never lands on GitHub usually means
   an **expired GitHub token** — check the token the bridge uses.

5. **Dashboard still stale?** It caches `data.json` network-first, so a hard
   refresh after step 4 succeeds should show the new weigh-in.

If a reading gets lost while the pipeline is down, add it manually via
[add-weighin.html](add-weighin.html) — it writes straight to
`Weight-tracker/data.json`.
