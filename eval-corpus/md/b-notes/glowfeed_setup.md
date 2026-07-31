# GlowFeed — Setup Guide

Get the app running on your iPhone. Follow each step in order.

## Step 0: Open Terminal

All commands in this guide are run in **Terminal** (macOS's built-in command line app).

- Press **Cmd + Space**, type "Terminal", press Enter
- A window with a text prompt will appear — this is where you type/paste commands

## Step 1: Install Homebrew (Package Manager)

Homebrew makes it easy to install developer tools. Paste this into Terminal:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Follow the on-screen instructions. When it's done, **close and reopen Terminal** so the `brew` command works.

Verify: `brew --version` should print a version number.

## Step 2: Install Xcode

1. Open the **App Store** on your Mac and search for **Xcode**
2. Install it (it's ~12GB — this will take a while)
3. **Open Xcode once** after installation:
   - Accept the license agreement when prompted
   - Let it install additional components (wait for it to finish)
4. Back in Terminal, install the command line tools:
   ```bash
   xcode-select --install
   ```

### Add Your Apple ID to Xcode

1. Open Xcode > menu bar > **Xcode > Settings** (or Cmd + ,)
2. Go to the **Accounts** tab
3. Click **+** at the bottom left > **Apple ID**
4. Sign in with your Apple ID (a free account works)

## Step 3: Install Other Dependencies

Paste these into Terminal one by one:

```bash
brew install python node
```

```bash
npm install -g pnpm
```

```bash
sudo gem install cocoapods
```

(`sudo` will ask for your Mac login password — type it and press Enter. The cursor won't move while typing, that's normal.)

## Step 4: Set Up Your iPhone

### Enable Developer Mode (iOS 16+)

1. On your iPhone: **Settings > Privacy & Security > Developer Mode**
2. Toggle **ON**
3. Your iPhone will ask to restart — tap **Restart**
4. After restart, confirm when prompted

### Connect to Mac

1. Connect your iPhone to your Mac with a **USB cable**
2. On your iPhone, tap **Trust** when asked "Trust This Computer?"
3. Enter your iPhone passcode

## Step 5: Clone the Project

```bash
git clone <repo-url>
cd glowfeed
```

(Replace `<repo-url>` with the actual GitHub URL you received.)

## Step 6: Set Up Environment Secrets

You should have received a `local.env` file from the project owner with all the API keys.

**Option A:** Drop the file directly into the `glowfeed/` folder.

**Option B:** Copy the template and fill in values:
```bash
cp local.env.example local.env
```
Then open `local.env` in any text editor and fill in the secrets.

## Step 7: Run the Setup Script

```bash
chmod +x setup.sh start.sh
./setup.sh
```

This automatically:
- Creates a Python virtual environment and installs backend dependencies
- Installs frontend JavaScript dependencies
- Installs iOS native dependencies (CocoaPods)
- Detects your LAN IP and configures the frontend

If anything is missing, the script will tell you what to install.

## Step 8: Fix Xcode Signing (First Time Only)

The project has a different developer's signing configuration. You need to switch it to your Apple ID:

1. Open the Xcode project:
   ```bash
   open frontend/ios/GlowFeed.xcworkspace
   ```
2. In the left sidebar, click the **GlowFeed** project (blue icon at the top)
3. Select the **GlowFeed** target (under TARGETS)
4. Click the **Signing & Capabilities** tab
5. Check **Automatically manage signing**
6. Under **Team**, select your Apple ID (it shows as "Your Name (Personal Team)")
7. If the Bundle Identifier shows an error, change it to something unique like:
   `com.glowfeed.app.yourname`
8. Close Xcode

## Step 9: Build & Run

Make sure your iPhone is connected via USB, then:

```bash
./start.sh --build
```

This starts the backend server and builds the app onto your iPhone. The first build takes a few minutes.

### Trust the Developer Certificate (First Time Only)

After the first build installs, your iPhone may show an **"Untrusted Developer"** alert:

1. On your iPhone: **Settings > General > VPN & Device Management**
2. Tap your developer certificate (shows your Apple ID email)
3. Tap **Trust**
4. Go back to the app and open it again

## Step 10: Subsequent Runs

After the first build, you don't need to rebuild every time. Just run:

```bash
./start.sh
```

Then open the GlowFeed app on your iPhone — it connects to the development server automatically.

Only use `./start.sh --build` again if you're told to (new packages added, native code changed, etc.).

## Important: Free Apple Account Limitations

With a free Apple ID (no $99 developer program), the signing certificate **expires every 7 days**. When it expires:
- The app will stop opening on your iPhone
- Just re-run `./start.sh --build` to reinstall with a fresh certificate

## Troubleshooting

### Build fails with "Signing" error

- Make sure you completed **Step 8** (fix Xcode signing)
- Open `frontend/ios/GlowFeed.xcworkspace` in Xcode
- Check that your Apple ID is selected as Team under Signing & Capabilities
- If "Bundle Identifier" shows a conflict, change it to something unique

### "Untrusted Developer" on iPhone

Settings > General > VPN & Device Management > tap your certificate > Trust.

### "Developer Mode" not enabled

Settings > Privacy & Security > Developer Mode > toggle ON > restart iPhone.

### Phone can't load the app / "Network error"

- Make sure your phone and computer are on the **same WiFi** network
- Check the IP in `frontend/.env` matches your computer's current LAN IP
  - Your IP can change when you reconnect to WiFi
  - Re-run: `ipconfig getifaddr en0` and update `frontend/.env`
- Test the backend from your phone's Safari: `http://<your-ip>:8000/health`
  - Should show `{"status":"ok"}`

### Backend won't start

- Check that `local.env` exists and has all secrets filled in (no `<placeholder>` values)
- Make sure no other process is using port 8000: `lsof -i :8000`

### pod install fails

- Run: `xcode-select --install`
- Try: `sudo gem install cocoapods`
- Nuclear option: `cd frontend/ios && rm -rf Pods Podfile.lock && pod install`

### App worked before but now won't open

Your free signing certificate expired (7-day limit). Re-run:
```bash
./start.sh --build
```
