#!/usr/bin/env bun
/**
 * Test script for Kitty graphics in scrollback buffer
 * 
 * Spams 10k lines to fill scrollback (triggering archival),
 * then displays an image using Kitty graphics protocol.
 * 
 * Usage:
 *   bun run scripts/test-kitty-scrollback.ts
 *   bun run scripts/test-kitty-scrollback.ts --image path/to/image.png
 */

import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";

const ESC = "\x1b";
const ST = `${ESC}\\`;

// Parse arguments
const args = process.argv.slice(2);
let imagePath = "assets/openmux-screenshot.png";
let lineCount = 10000;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--image" && args[i + 1]) {
    imagePath = args[i + 1];
    i++;
  } else if (args[i] === "--lines" && args[i + 1]) {
    lineCount = parseInt(args[i + 1], 10);
    i++;
  }
}

// Find the image
const possiblePaths = [
  imagePath,
  path.join("ssets", "openmux-screenshot.png"),
  path.join("..", "assets", "openmux-screenshot.png"),
  path.join("..", "ssets", "openmux-screenshot.png"),
];

let resolvedImagePath: string | null = null;
for (const p of possiblePaths) {
  if (fs.existsSync(p)) {
    resolvedImagePath = p;
    break;
  }
}

if (!resolvedImagePath) {
  console.error("Error: Could not find image file");
  console.error("Searched:", possiblePaths.join(", "));
  process.exit(1);
}

console.log(`\x1b[1;33m=== Kitty Graphics Scrollback Test ===\x1b[0m`);
console.log("");
console.log(`Found image: ${resolvedImagePath}`);
console.log(`Will spam ${lineCount.toLocaleString()} lines`);
console.log("");

// Check for kitty support
const isKitty = process.env.KITTY_WINDOW_ID !== undefined;
const isGhostty = process.env.GHOSTTY_RESOURCES_DIR !== undefined;

if (!isKitty && !isGhostty) {
  console.log("\x1b[1;33mWarning: Not running in Kitty or Ghostty terminal\x1b[0m");
  console.log("This test requires a terminal with Kitty graphics protocol support");
  console.log("");
}

// Spam lines to fill scrollback
console.log(`\x1b[1;33mSpamming ${lineCount.toLocaleString()} lines to fill scrollback...\x1b[0m`);

const batchSize = 1000;
const batches = Math.ceil(lineCount / batchSize);

for (let b = 0; b < batches; b++) {
  const start = b * batchSize + 1;
  const end = Math.min((b + 1) * batchSize, lineCount);
  
  for (let i = start; i <= end; i++) {
    console.log(`[${i.toString().padStart(5, "0")}] This is line ${i.toLocaleString()} of ${lineCount.toLocaleString()} - filling scrollback buffer with content`);
  }
  
  // Progress indicator
  if ((b + 1) % 10 === 0 || b === batches - 1) {
    const progress = Math.round(((b + 1) / batches) * 100);
    console.error(`\x1b[2K\r\x1b[1;32mProgress: ${progress}% (${end.toLocaleString()} / ${lineCount.toLocaleString()} lines)\x1b[0m`);
  }
}

console.log("");
console.log("\x1b[1;32mDone spamming lines\x1b[0m");
console.log("");

// Function to send Kitty graphics command directly
function sendKittyImage(imagePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const imageData = fs.readFileSync(imagePath);
    const base64Data = imageData.toString("base64");
    
    // Build the Kitty graphics command
    // a=T (transmit and display), f=100 (PNG), s/v=size, t=d (direct)
    const { size } = fs.statSync(imagePath);
    
    // Get image dimensions (simplified - assumes we don't have sharp installed)
    // For PNG, we can read the IHDR chunk
    let width = 0;
    let height = 0;
    
    if (imageData[0] === 0x89 && imageData[1] === 0x50) {
      // PNG signature
      // IHDR chunk starts at byte 16, width/height at bytes 16-24
      width = imageData.readUInt32BE(16);
      height = imageData.readUInt32BE(20);
    }
    
    // Build the sequence
    let sequence = `${ESC}_Ga=T,f=100`;
    if (width > 0) sequence += `,s=${width}`;
    if (height > 0) sequence += `,v=${height}`;
    sequence += `;${base64Data}${ST}`;
    
    process.stdout.write(sequence, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

// Display the image
async function displayImage() {
  console.log("\x1b[1;33mDisplaying image using Kitty graphics protocol...\x1b[0m");
  console.log("");
  
  try {
    // Try using kitten icat if available
    const hasKitten = await new Promise<boolean>((resolve) => {
      const proc = spawn("which", ["kitten"], { stdio: "ignore" });
      proc.on("exit", (code) => resolve(code === 0));
    });
    
    if (hasKitten) {
      console.log("Using kitten icat...");
      const proc = spawn("kitten", ["icat", resolvedImagePath!], {
        stdio: "inherit"
      });
      
      await new Promise<void>((resolve, reject) => {
        proc.on("exit", (code) => {
          if (code === 0) resolve();
          else reject(new Error(`kitten icat exited with code ${code}`));
        });
      });
    } else {
      // Fall back to direct protocol
      console.log("Using direct Kitty graphics protocol...");
      await sendKittyImage(resolvedImagePath!);
    }
    
    console.log("");
    console.log("\x1b[1;32mImage displayed!\x1b[0m");
    console.log("");
    console.log("Instructions:");
    console.log("  1. Scroll UP to see the image in scrollback");
    console.log("  2. The image should remain visible even when scrolled");
    console.log("  3. Continue scrolling to see the 10k lines we spammed");
    console.log("  4. Scroll back down to return to the prompt");
    console.log("");
    console.log("\x1b[1;33mPress Enter to exit...\x1b[0m");
    
    // Wait for Enter
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.exit(0);
    });
    
  } catch (err) {
    console.error("\x1b[1;31mError displaying image:\x1b[0m", err);
    process.exit(1);
  }
}

displayImage();
