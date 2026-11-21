---
name: cut-frame-screen
description: Frame a screen recording on what is being done or shown (the pane in use, the text read aloud, the thing pointed at) with smooth zooms, and keep a camera inset clear. Use at the visuals stage of a cut with screen footage.
---

# Frame the screen on the work

While the screen is on picture, the frame holds what the speaker is doing or showing: the pane it happens in, whole, with its own title and controls. Not one detail inside it, not the window around it, not the desktop.

## Find the subject

What the speaker says decides the subject. `python $ENGINE/focus.py <source> <t0> <t1>` helps find it: it counts where the picture changes in a stretch and gives a zoom box shaped like the video, limited to 2x. Mask out the camera inset (`--mask x,y,w,h`) and check a box with `--draw still.png` before you use it. When almost nothing or almost everything changes, it says so and gives zoom 1: decide from the words.

- When the speaker uses or demos something, that pane fills the frame; sidebars, file lists, toolbars and the desktop stay out.
- When text is on screen for the viewer to read, zoom until it reads easily at the video's size, and follow it down the page gently at the same size.
- When the speaker points at one thing (a chart, a reply, a line of code), that thing fills the frame, whole.
- The taskbar, tabs, address bar and notifications stay out unless they are what is shown.

## The zooms

- Every change of subject is a smooth zoom (`ease` about 0.4 to 1 s), never a jump, and it starts as the speaker names the thing.
- Pull back out when they move on, or go straight to the next subject when they name it at once.
- Hold each frame for at least a couple of seconds. When they touch on things faster than that, hold one frame wide enough for all of them.
- Moves follow what is said, not the pointer. One push in for a passage, not one per line. Tight enough to read is tight enough.
- The picture always fills the video. Check the framed stretch, mid-zoom too, so the frame never cuts off something used a moment later.

## The camera inset

The inset stays in its corner at its size. Place the subject so the inset doesn't cover it, or give the zoom a `mask` that hides the inset while zoomed. Switching between the full-screen camera and the screen is a bigger change than a zoom: do it sparingly, let each side hold for a stretch, and line the switch up with a cut. A few frames of one between two stretches of the other reads as a glitch.
