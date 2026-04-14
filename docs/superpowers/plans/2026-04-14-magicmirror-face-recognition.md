# MagicMirror Face Recognition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add face recognition to MagicMirror on Raspberry Pi so that when Domes is detected, his profile activates (Google Calendar visible, "Hi, Domes" greeting shown); after 2 minutes without a face, the anonymous profile returns.

**Architecture:** MMM-Face-Reco-DNN handles camera input and face recognition via OpenCV DNN + face_recognition Python library, emitting `CURRENT_USER` / `EVERYBODY_LEAVES` MM notifications. A new MMM-Greeting module listens for those notifications and shows/hides the greeting. Profile switching uses MagicMirror's built-in `classes` config key.

**Tech Stack:** Raspberry Pi OS, Python 3, OpenCV, face_recognition (dlib), Node.js, MagicMirror²

**All commands run on Pi via SSH:** `ssh admin@10.0.0.249`

---

### Task 1: Install system dependencies on Pi

**Files:**
- No files created — system packages only

- [ ] **Step 1: SSH onto the Pi**

```bash
ssh admin@10.0.0.249
```

- [ ] **Step 2: Update package list and install build deps**

```bash
sudo apt-get update
sudo apt-get install -y cmake libopenblas-dev liblapack-dev \
  libx11-dev libgtk-3-dev python3-dev python3-pip \
  python3-opencv libatlas-base-dev
```

Expected: packages install without errors.

- [ ] **Step 3: Install Python face recognition libraries**

> ⚠️ dlib compilation on Pi 4 takes ~30–60 minutes. Run in a tmux session so SSH disconnect doesn't kill it.

```bash
sudo apt-get install -y tmux
tmux new -s install
pip3 install face_recognition imutils
```

Detach with `Ctrl+B D`. Reattach later with `tmux attach -t install`.

- [ ] **Step 4: Verify installation**

```bash
python3 -c "import face_recognition; import cv2; print('OK')"
```

Expected output:
```
OK
```

- [ ] **Step 5: Commit note (no code change — document in git)**

```bash
cd ~/MagicMirror
git add -A
git commit -m "chore: system deps installed for face recognition" --allow-empty
```

---

### Task 2: Install MMM-Face-Reco-DNN module

**Files:**
- Create: `~/MagicMirror/modules/MMM-Face-Reco-DNN/` (cloned from git)
- Create: `~/MagicMirror/modules/MMM-Face-Reco-DNN/dataset/Domes/` (training data dir)

- [ ] **Step 1: Clone the module**

```bash
cd ~/MagicMirror/modules
git clone https://github.com/nischi/MMM-Face-Reco-DNN.git
cd MMM-Face-Reco-DNN
npm install
```

- [ ] **Step 2: Create dataset directory for Domes**

```bash
mkdir -p ~/MagicMirror/modules/MMM-Face-Reco-DNN/dataset/Domes
```

- [ ] **Step 3: Verify module structure**

```bash
ls ~/MagicMirror/modules/MMM-Face-Reco-DNN/
```

Expected output contains: `MMM-Face-Reco-DNN.js`, `node_helper.js`, `tools/`, `dataset/`

- [ ] **Step 4: Commit**

```bash
cd ~/MagicMirror
git add modules/MMM-Face-Reco-DNN
git commit -m "feat: add MMM-Face-Reco-DNN module"
```

---

### Task 3: Collect training photos and encode face

**Files:**
- Create: `~/MagicMirror/modules/MMM-Face-Reco-DNN/dataset/Domes/1.jpg` … `10.jpg`
- Create: `~/MagicMirror/modules/MMM-Face-Reco-DNN/encoded_faces.pickle` (generated)

- [ ] **Step 1: Copy photos from your Windows PC to Pi**

On your Windows machine, take ~10 photos of your face (different angles, different lighting). Then copy them to the Pi:

```bash
# Run on Windows (from C:\Users\domes)
scp foto1.jpg foto2.jpg foto3.jpg foto4.jpg foto5.jpg \
    foto6.jpg foto7.jpg foto8.jpg foto9.jpg foto10.jpg \
    admin@10.0.0.249:/home/admin/MagicMirror/modules/MMM-Face-Reco-DNN/dataset/Domes/
```

Or rename them in sequence on the Pi after copying:

```bash
# On Pi — rename to 1.jpg, 2.jpg etc. if needed
cd ~/MagicMirror/modules/MMM-Face-Reco-DNN/dataset/Domes
ls -1 | cat -n
```

- [ ] **Step 2: Verify photos are present**

```bash
ls ~/MagicMirror/modules/MMM-Face-Reco-DNN/dataset/Domes/
```

Expected: at least 5–10 jpg files visible.

- [ ] **Step 3: Encode the faces**

```bash
cd ~/MagicMirror/modules/MMM-Face-Reco-DNN
python3 tools/encode_faces.py -i dataset -e encoded_faces.pickle -d hog
```

Expected output ends with:
```
[INFO] serializing encodings...
```

- [ ] **Step 4: Verify encoded file was created**

```bash
ls -lh ~/MagicMirror/modules/MMM-Face-Reco-DNN/encoded_faces.pickle
```

Expected: file exists and is > 0 bytes.

- [ ] **Step 5: Commit**

```bash
cd ~/MagicMirror
git add modules/MMM-Face-Reco-DNN/encoded_faces.pickle
git commit -m "feat: add encoded face data for Domes"
```

---

### Task 4: Create MMM-Greeting module

**Files:**
- Create: `~/MagicMirror/modules/MMM-Greeting/MMM-Greeting.js`
- Create: `~/MagicMirror/modules/MMM-Greeting/MMM-Greeting.css`

- [ ] **Step 1: Create module directory**

```bash
mkdir -p ~/MagicMirror/modules/MMM-Greeting
```

- [ ] **Step 2: Create MMM-Greeting.js**

```bash
cat > ~/MagicMirror/modules/MMM-Greeting/MMM-Greeting.js << 'EOF'
Module.register("MMM-Greeting", {
    defaults: {
        message: "Hi, Domes"
    },

    start: function () {
        this.visible = false;
    },

    getDom: function () {
        const wrapper = document.createElement("div");
        wrapper.className = "MMM-Greeting";
        if (this.visible) {
            wrapper.innerHTML = this.config.message;
        }
        return wrapper;
    },

    notificationReceived: function (notification, payload) {
        if (notification === "CURRENT_USER") {
            this.visible = true;
            this.updateDom();
        } else if (notification === "EVERYBODY_LEAVES") {
            this.visible = false;
            this.updateDom();
        }
    },

    getStyles: function () {
        return ["MMM-Greeting.css"];
    }
});
EOF
```

- [ ] **Step 3: Create MMM-Greeting.css**

```bash
cat > ~/MagicMirror/modules/MMM-Greeting/MMM-Greeting.css << 'EOF'
.MMM-Greeting {
    font-size: 2em;
    font-weight: bold;
    color: white;
    text-align: center;
    padding: 10px;
}
EOF
```

- [ ] **Step 4: Verify files**

```bash
cat ~/MagicMirror/modules/MMM-Greeting/MMM-Greeting.js
cat ~/MagicMirror/modules/MMM-Greeting/MMM-Greeting.css
```

- [ ] **Step 5: Commit**

```bash
cd ~/MagicMirror
git add modules/MMM-Greeting
git commit -m "feat: add MMM-Greeting module"
```

---

### Task 5: Update config.js

**Files:**
- Modify: `~/MagicMirror/config/config.js`

- [ ] **Step 1: Backup existing config**

```bash
cp ~/MagicMirror/config/config.js ~/MagicMirror/config/config.js.bak
```

- [ ] **Step 2: Replace config.js with updated version**

```bash
cat > ~/MagicMirror/config/config.js << 'EOF'
let config = {
    address: "localhost",
    port: 8080,
    basePath: "/",
    ipWhitelist: ["127.0.0.1", "::ffff:127.0.0.1", "::1"],
    useHttps: false,
    httpsPrivateKey: "",
    httpsCertificate: "",
    language: "en",
    locale: "en-US",
    logLevel: ["INFO", "LOG", "WARN", "ERROR"],
    timeFormat: 24,
    units: "metric",

    modules: [
        {
            module: "alert"
        },
        {
            module: "updatenotification",
            position: "top_bar"
        },
        {
            module: "clock",
            position: "top_left"
        },
        {
            module: "MMM-Greeting",
            position: "top_center"
        },
        {
            module: "MMM-Face-Reco-DNN",
            config: {
                usernameTimeout: 120000,
                interval: 2,
                users: ["Domes"],
                welcomeMessage: ""
            }
        },
        {
            module: "weather",
            position: "top_right",
            config: {
                weatherProvider: "openmeteo",
                type: "current",
                lat: 49.1928408,
                lon: 16.6166969
            }
        },
        {
            module: "weather",
            position: "top_right",
            header: "Weather Forecast",
            config: {
                weatherProvider: "openmeteo",
                type: "forecast",
                lat: 49.1928408,
                lon: 16.6166969
            }
        },
        {
            module: "newsfeed",
            position: "bottom_bar",
            config: {
                feeds: [
                    {
                        title: "News toto je test",
                        url: "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml"
                    }
                ],
                showSourceTitle: true,
                showPublishDate: true,
                broadcastNewsFeeds: true,
                broadcastNewsUpdates: true
            }
        },
        {
            module: "MMM-GoogleCalendar",
            header: "Moro systems",
            position: "top_left",
            classes: "Domes",
            config: {
                calendars: [
                    {
                        symbol: "calendar-week",
                        calendarID: "dominik.zdrahala@morosystems.cz"
                    }
                ]
            }
        }
    ]
};

/*************** DO NOT EDIT THE LINE BELOW ***************/
if (typeof module !== "undefined") { module.exports = config; }
EOF
```

- [ ] **Step 3: Validate config syntax**

```bash
node -e "const c = require('./config/config.js'); console.log('Config OK, modules:', c.modules.length)"
```

Expected output:
```
Config OK, modules: 9
```

- [ ] **Step 4: Commit**

```bash
cd ~/MagicMirror
git add config/config.js
git commit -m "feat: enable face recognition profile switching in config"
```

---

### Task 6: End-to-end test

**Files:**
- No new files

- [ ] **Step 1: Restart MagicMirror**

```bash
cd ~/MagicMirror
pm2 restart MagicMirror
# Or if not using pm2:
npm run start
```

- [ ] **Step 2: Watch logs for face recognition activity**

```bash
pm2 logs MagicMirror --lines 50
```

Look for lines like:
```
[MMM-Face-Reco-DNN] Starting face recognition...
```

- [ ] **Step 3: Stand in front of the camera**

Stand in front of the Pi camera. Within ~5 seconds the mirror should:
- Show "Hi, Domes" at `top_center`
- Show the Google Calendar module at `top_left`

- [ ] **Step 4: Test timeout**

Step away from the mirror. After 2 minutes:
- "Hi, Domes" disappears
- Google Calendar hides

- [ ] **Step 5: If face not recognized — retrain with more photos**

If recognition fails, add more photos (vary lighting, angle, distance) and re-encode:

```bash
# Add more photos to dataset/Domes/ then re-run:
cd ~/MagicMirror/modules/MMM-Face-Reco-DNN
python3 tools/encode_faces.py -i dataset -e encoded_faces.pickle -d hog
```

Then restart MagicMirror.

- [ ] **Step 6: Final commit**

```bash
cd ~/MagicMirror
git add -A
git commit -m "feat: face recognition profile switching complete"
```
