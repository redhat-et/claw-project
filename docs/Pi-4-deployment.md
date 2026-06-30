### Pi 4 Openclaw Deployment (Headless)

### Prerequisites

* **Raspberry Pi 4** (2GB, 4GB, or 8GB RAM variants all work perfectly).
* **64-bit OS Architecture** (Required; OpenClaw's compiled core binaries will not execute on older 32-bit operating systems).
* **Storage Device:** A high-quality MicroSD card (16GB minimum) or a USB 3.0 SSD (Highly recommended for long-term server reliability and speed).
* **An LLM API Key:** An API token from OpenAI or Anthropic Claude to power your agent's reasoning.

---

### Step 1: Flash Raspberry Pi OS (64-bit)

Running a "Lite" or headless operating system leaves the maximum amount of RAM available for your OpenClaw background routing server.

1. Open [**Raspberry Pi Imager**](https://www.raspberrypi.com/software/) on your computer.
2. Click **Choose Device** and select **Raspberry Pi 4**.
3. Click **Choose OS** $\rightarrow$ **Raspberry Pi OS (other)** $\rightarrow$ **Raspberry Pi OS Lite (64-bit)**.
4. Click **Next**. When prompted to apply OS customization settings, click **Edit Settings** (the gear icon):
* Check the box to **Enable SSH** (Crucial for remote network management).
* Set your custom administrative **Username and Password**.
* Configure your home **Wi-Fi credentials** (or leave blank if plugging in an Ethernet cable).


5. Choose your target MicroSD card or USB storage drive, then click **Write** to flash the drive.

---

### Step 2: Boot the Pi & Discover Your Local IP Address

Once flashing finishes, insert the storage drive into your Pi 4 and power it on. Give it 1 to 2 minutes to boot and connect to your home network router.

To access your Pi via SSH from your computer, you must find its **Local Network IP address** (typically structured like `192.168.x.x` or `10.x.x.x`). The local IP will usually be displayed on the boot screen.
*(Note: Do not use `127.0.1.1` if you see it on the Pi's local boot screen—that is a loopback address, meaning your computer will just loop back into itself when you try to ping or SSH into it).*

#### How to find the correct Local Network IP:

* **If you have a monitor/keyboard attached to the Pi:** Log into the command line and type:
```bash
hostname -I

```


*(Note: That is a capital letter "i". It will instantly print your true local network IP address).*
* **If running entirely headless (no monitor):** Look at your home router's administrative page under "Connected Devices" for a device named `raspberrypi`. Alternatively, try using its local hostname directly from your computer terminal:
```bash
ssh username@raspberrypi.local

```



Once you have the real IP address, open your personal computer's terminal and connect over your local network:

```bash
ssh username@your_pi_ip_address

```

---

### Step 3: Update the System & Download OpenClaw

Once logged into your Pi terminal, ensure all core Linux packages are fully up to date, and then deploy the official automated installation script:

```bash
sudo apt update && sudo apt upgrade -y
curl -fsSL https://openclaw.ai/install.sh | bash

```

---

### Step 4: Run the Interactive Onboarding Wizard

To configure your AI provider gateway, search engine capabilities, and standard system paths, launch the built-in configuration utility:

```bash
openclaw onboard --install-daemon

```

#### Selection Recommendations:

1. **Onboarding Mode:** Select `QuickStart`.
2. **Model/Auth Provider:** Select your chosen AI core (e.g., OpenAI) and paste your API key when prompted.
3. **Web Search Provider:** Highlight **`Parallel Search (Free)`** and press `Enter`.
* *Why this choice?* Parallel search is free and does not require an API key.


4. **Channels & Skills:** Select **"Skip for now"** to complete the initial baseline setup. You can add communication bridges (like Telegram) later via the Web UI or using `openclaw channels add`.

---

### Step 5: Fix Command Path & Configure Background Service

#### 1. Permanently Fix "-bash: openclaw: command not found"

If your shell says `command not found` right after installing, your Linux terminal environment simply doesn't know where your global Node/NPM program shortcuts live. Fix this permanently by registering the NPM path into your profile:

```bash
echo 'export PATH="$(npm prefix -g)/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc

```

*(Now, commands like `openclaw` will work seamlessly throughout your entire terminal environment).*

#### 2. Configure Systemd to Stay Alive in the Background

To ensure your agent router survives reboots and stays running 24/7 without requiring an active SSH connection, configure a persistent background user service.

First, enable user space **lingering**:

```bash
sudo loginctl enable-linger "$(whoami)"

```

Next, open the system configuration file for the OpenClaw service:

```bash
systemctl --user edit openclaw-gateway.service

```

An empty text editor will appear. Paste the following configuration directly into it, then save and exit (`Ctrl+O`, `Enter`, `Ctrl+X` in Nano):

```ini
[Service]
Environment=OPENCLAW_NO_RESPAWN=1
Environment=NODE_COMPILE_CACHE=/var/tmp/openclaw-compile-cache
Restart=always
RestartSec=2
TimeoutStartSec=90

```

Reload the service daemon and restart the gateway process to apply your optimizations:

```bash
systemctl --user daemon-reload
systemctl --user restart openclaw-gateway.service

```

Verify that the background engine is running normally:

```bash
openclaw gateway status

```

---

### Step 6: Connect Securely to the Web Control UI Dashboard

Because OpenClaw operates on local internal ports (`18789`) and headless systems block external public web access for safety, you must connect using a secure tunnel bridge.

#### 1. Retrieve Your Unique Authentication Token

Inside your **Raspberry Pi terminal**, request the direct dashboard URL:

```bash
openclaw dashboard --no-open

```

This command will print an authenticated URL to your terminal console that looks like this:
`http://127.0.0.1:18789/?token=oc_abc123xyz...`
Copy this full link structure (including the `?token=...` string).

*(Note: If a token was never initially built during your setup wizard, generate one instantly by typing: `openclaw doctor --generate-gateway-token`)*

#### 2. Establish the Network Bridge Tunnel

On your **personal computer or laptop** (open a completely brand new, separate terminal window), execute the SSH forwarding tunnel:

```bash
ssh -N -L 18789:127.0.0.1:18789 username@your_pi_ip_address

```

*Note: This terminal window will look like it freezes or hangs on a blank line when you hit enter. Leave it open in the background—it is holding open your network bridge.*

#### 3. Access Your Dashboard

Open any browser on your personal computer (Chrome, Firefox, Safari) and paste the exact tokenized link you copied from the Pi in Step 6.1 into the address bar.

You are now successfully inside your OpenClaw Control Panel! You can begin chatting directly with your agent, tweaking settings, and activating skills right from your browser.
