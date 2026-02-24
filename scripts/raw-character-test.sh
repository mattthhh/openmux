#!/bin/bash

# Save current terminal settings
original_stty_settings=$(stty -g)

# Restore terminal settings on script exit using a trap
trap 'stty "$original_stty_settings"; echo "Restored terminal settings."' EXIT

echo "Raw mode enabled. Press keys to see their sequences. Press 'q' to quit."

# Set terminal to cbreak mode (a form of raw mode):
# -icanon disables canonical mode (line buffering)
# -echo disables character echoing
stty -icanon -echo

# Loop to read characters
while true; do
  # Read one character at a time (-n 1) without a newline
  read -n 1 char

  # Display the character and its hex value for sequence identification
  printf "Key pressed: '%s' (Hex: 0x%x)\n" "$char" "'$char"

  # Exit loop if 'q' is pressed
  if [[ "$char" == "q" ]]; then
    break
  fi
done

# The trap command will automatically restore the original settings upon exiting the script.
