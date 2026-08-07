# Eksplorador Project - GIS Heatmap & Rover Control System

Welcome to the **Eksplorador** project repository! This project combines a cross-platform GIS Heatmap desktop application with microcontrollers to monitor and control our rover in real time.

---

## 🛠️ Prerequisites

Before getting started, make sure you have the required software installed depending on your role in the team:

### 1. General Setup (All Team Members)
* **Git:** [Download Git](https://git-scm.com/downloads) or use **[GitHub Desktop](https://desktop.github.com/)** for GUI management.
* **VS Code:** Recommended editor for both software and embedded development.

### 2. Desktop App Developers (Tauri + React + SQLite)
* **Node.js (LTS Version):** [Download Node.js](https://nodejs.org/) (includes `npm`).
* **C++ Build Tools (Windows Users):** Required by Rust to compile native Windows apps.
  * Download **[Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)**, run the installer, and select **"Desktop development with C++"**.
* **Rust:** Install via [rustup.rs](https://rustup.rs/) (accept default installation settings).

### 3. Embedded Hardware Developers (ESP32 & Arduino)
* **PlatformIO IDE (Recommended):** Install the **PlatformIO IDE** extension directly inside VS Code for seamless firmware compilation and uploading.
* *Alternative:* **Arduino IDE 2.x** with installed ESP32 core board support.

---

## 📁 Repository Folder Structure

```text
Eksplorador-project/
├── apps/
│   └── desktop/            # Tauri + React + Vite + Leaflet + SQLite desktop app
│       ├── src/            # React UI components, Leaflet map setup, heatmap layers
│       ├── src-tauri/      # Rust backend logic, native windowing, SQLite integration
│       └── package.json    # Frontend dependencies
├── embedded/               # Microcontroller source code & firmware
│   ├── esp32-rover/        # Code uploaded to the physical rover (sensors, telemetry)
│   ├── esp32-desktop/      # Ground station transceiver connected via USB to PC
│   └── arduino-mega/       # Low-level hardware control (motors, actuators)
├── docs/                   # Circuit diagrams, pinout configurations, system specs
├── .gitignore              # Keeps heavy binaries, node_modules, and target files off Git
└── README.md               # Project documentation
