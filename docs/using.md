# Using the app: a tour of the screen

This page walks through the screen in the order you meet it. Every name, button and key here is the one on the screen. For what happens behind it (the lock, the overlay windows, the sleeping agent), read [how-it-works.md](how-it-works.md).

- [The top bar and projects](#the-top-bar-and-projects)
- [The stage chips](#the-stage-chips)
- [Approve, lock and send back](#approve-lock-and-send-back)
- [The Edit tab](#the-edit-tab)
  - [Media and the transcript](#media-and-the-transcript)
  - [The viewer](#the-viewer)
  - [The timeline](#the-timeline)
  - [The Cuts list](#the-cuts-list)
  - [The agent panel](#the-agent-panel)
  - [The visuals proof and the final review](#the-visuals-proof-and-the-final-review)
- [The Shorts tab](#the-shorts-tab)
- [The Studio tab](#the-studio-tab)
- [The Export tab](#the-export-tab)
- [The Context tab](#the-context-tab)
- [The Setup tab](#the-setup-tab)
- [Settings](#settings)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [On a phone](#on-a-phone)

## The top bar and projects

Left to right: the app name, the **project picker**, then the tabs **Edit**, **Shorts**, **Studio**, **Context**, **Export** and **Setup**, a **?** button (the keys, see [below](#keyboard-shortcuts)) and a small light that is green while the screen is connected to the server. Under it run the stage chips.

The address of the page is `#/<project>/<tab>`, so a link opens the same project and tab. The app remembers the last project you had open in this browser. While the agent waits for an answer of yours, the browser tab's title starts with `(!) Your answer`.

### Start a project

Press the project picker. It lists your projects, each with its recipe and where it is ("Edit a video · 4 of 7: Visuals", or "finished"). Under **New project**:

1. Type a name in the box ("What is it called?").
2. Choose a **Recipe**. A line under the box says what it does.
3. Press **Create** (or Enter in the name box).

The four recipes:

| recipe | use it when |
|---|---|
| **Edit a video** | you have the footage of a long (16:9) video |
| **A video from the idea** | you start from a topic: research, a plan, you record, then the edit, titles, thumbnails and upload |
| **Edit a Short** | you have footage for one vertical (9:16) Short |
| **Shorts from a long video** | you have a long video; the agent picks the moments, you keep or drop each, it cuts the ones you kept |

### Drop footage in

The new project opens on the Edit tab. Put your recordings into **Media**: press **Add footage**, or drag video or sound files anywhere on the Edit tab. Other file types are refused ("Only video and sound files go into the footage"). The files are copied into the project's `video/footage` folder. You can add more later.

Then press **Go** on the first stage (see [The stage chips](#the-stage-chips)). Agent stages after it start by themselves one after the other until a stage needs you (the setting `chain` in [configuration.md](configuration.md#settings) turns that off).

Your projects live in `data/projects/<id>/`. What is in a project folder is in [configuration.md](configuration.md#whats-in-a-project-folder).

## The stage chips

The row under the top bar shows the stages of the project's recipe, numbered, one chip each. A chip shows its icon, number, name, and the time and cost of that stage once it ran. The colour and icon say the state:

| state | meaning |
|---|---|
| done (a tick) | finished; shows the time it took and what it cost |
| working | the agent works; a clock runs on the chip and the cost grows |
| waiting for your answer | the agent asked you something (see [the agent panel](#the-agent-panel)) |
| in line | a render stage waiting behind another project's render; the chip says what it waits behind |
| your turn | a stage that only you can finish: an approval, recording, a pick, upload, export |
| ready | an agent stage you start with **Go** |
| halted | something stopped the project; a bar under the chips says why |
| later | not reached yet |

Hover a chip for its full name, its state, the time and cost, and whether approving it locks the talk. A lock icon marks the stage that locks. Click a chip of an agent stage to open the Context tab on what that stage reads; the Brief chip opens the brief. When the row is too narrow the chips shrink to a number and a short name (the current one stays in full) and scroll sideways.

Right of the chips are the totals: the clock (time) and the coin (cost so far, as your Claude subscription counts it). Hover them to see how stages, the Studio and talking to the agent add up.

Right of those are the buttons of the current stage. Which ones show depends on the state:

| button | does |
|---|---|
| **Go** | runs the stage that is next |
| **Answer** | takes you to the agent's open question |
| **Stop** | stops the agent (or, for a stage in line, leaves the line) |
| **Resume** | clears a halt and carries on (not for a changed locked file, see below) |
| **Approve** or **Approve & lock** | approves the stage you are at |
| **Send back** | sends it back to the agent with your notes |

A stage in line starts by itself when the render in front of it ends. How many renders run at once is the setting `heavy`.

## Approve, lock and send back

**Approve** and **Send back** open a small box with a notes field that keeps what you type. The same note is there if you open the other one.

- **Approve & lock** is on the rough review. The box says: "This locks the talk: the edit list and the rough are hashed, and nothing after this can change a word. A changed locked file halts the project." Nothing later in the project can change a word of the approved talk. How: [how-it-works.md](how-it-works.md#the-lock).
- If you struck words, restored cuts or moved joins in the editor, the rough does not have those choices yet, so it cannot be locked as it is. The box then reads "Your choices need a rebuild first" and offers **Rebuild with my choices**: it sends the rough back to the agent with your choices, it builds the rough again, and you approve that one. **Approve & lock** is greyed out until then.
- **Send back** goes to the stage the gate points back to (the rough review sends the project back to the rough cut, the final review back to the visuals). Under the notes box, "Sent with it:" lists the choices from the Cuts list and the transcript that go along. The agent changes only what the notes name.
- Approving a stage where you only wanted to say something: write it in the optional box ("Anything to add?"); it goes to the agent's next stage.

If a locked file changed after you approved (the project is **halted** and the bar says "A locked file changed after you approved Rough review ..."), there are two ways out: **Approve** the new version (the files are hashed again) or **Send back** with notes. **Resume** does not clear this halt.

## The Edit tab

The Edit tab is laid out like a video editor: **Media** and **Transcript** on the left, the **Viewer** in the middle, **Cuts** and the **Agent** on the right, the **Timeline** at the bottom. Every bar between the panels drags to resize, and the sizes are remembered.

### Media and the transcript

**Media** lists the footage. A tag shows the name the edit gives each recording (`r1`, `r2`, ...), or `new` for a file the edit does not use yet. Click a file to play it as recorded (Before). The **Edit list** row shows how many pieces and cuts the rough has.

The **Transcript** shows the words of the recording picked in its menu, as spoken. Words that play are plain; words the agent cut and words you struck are crossed out (hover one to see which cut removed it). The line at the top says "754 of 798 words play". Long stretches of the recording that the edit does not use fold into a line ("N words not in the edit"); click it to open.

- Drag across words, or click one and Shift-click another, to select them.
- **Strike** (or Delete) cuts the selected words. **Bring back** restores the cut or undoes your strike.
- The eye button makes the transcript follow the playhead.

Strikes, restores and moved joins change a **working edit list** (`video/out/edl.working.json`), which plays at once in the viewer, so nothing is rendered to preview a change. The agent builds the real rough from it only when you send the rough back or press **Rebuild rough** on the timeline (it asks you first, because it runs the agent). Once the talk is locked, strikes and trims are refused with a message.

### The viewer

The viewer plays the working edit list live. Below it: previous cut, a frame back, **play / pause**, a frame on, next cut, the time (`hours:minutes:seconds:frames`), **Blur box**, and the four modes:

| mode | shows |
|---|---|
| **Before** | the recording as it was, from the same moment, removed words and all |
| **After** | your edit, live |
| **A/B** | the current cut's own Before clip, then its After clip |
| **Final** | the rendered `final.mp4` with its overlays and captions; the button appears once a final exists, and a new final opens in this mode by itself |

`\` flips between Before and After. A small badge in the corner of the picture says `wait ×N` (a wait played faster), `still` (a held frame), `card` or `final`.

**Blur box** hides what must not be seen. Press it, then drag a box on the picture (it works in After and Final). It runs from your marked **In** to **Out** when both are set, else for three seconds from the playhead. Drag the box to move it and its corners to resize. A panel for the picked box lets you choose how it hides (**Blur**, **Pixelate**, **Black box**), set its start and end with **In = playhead (I)** and **Out = playhead (O)**, **Go to it**, **Delete**, and close (**✕**). Esc cancels a box you are drawing. Boxes are saved at once to `video/out/redactions.json` and drawn into the video the next time it renders.

### The timeline

The timeline has a ruler and four tracks:

| track | holds |
|---|---|
| ruler | review markers (small flags) and the In and Out marks |
| **V2** | overlays and your blur boxes |
| **CC** | captions |
| **V1** | the clips and the cuts: flagged cuts in amber, yours in red, restored ones in green |
| **A1** | the sound waveform |

Click or drag on the ruler or empty space to move the playhead. It snaps to edges and cuts; hold Shift to turn that off for one drag, or press **S** to switch snapping on or off.

- **Zoom** with the slider, the zoom buttons, `=` and `-`, Ctrl and the mouse wheel; **Fit** (Shift+Z) shows the whole edit. The mouse wheel alone scrolls.
- **Markers.** The flags on the ruler are things the agent asks you to look or listen at and flagged cuts. Hover for the words, click to jump there. Blue is a review item, amber a flagged cut, red-orange private information on screen, grey one you marked as looked at.
- **In and Out.** `I` and `O` mark them at the playhead; Ctrl+Shift+X clears them.
- **Trim a join** on V1: click or drag one side of a join (left of it is the end of the piece before, right of it the start of the piece after) and drag it, or press `,` and `.` to move it a frame. A trim that would clip a word warns you. Ctrl+Z undoes.
- **Blade** (`B`, or the **Blade** button) splits the piece at the playhead. **Ripple delete** (Shift+Delete) takes out the stretch from In to Out and closes the gap.
- **Overlay inspector.** Click an overlay on V2 to open its inspector. You can change its **Words**, its other text and number settings, its **From (s)** and **To (s)** (the **⟵ playhead** buttons fill them from the playhead), or tick **Hide** to leave it out. **Play it** plays it; **Undo my changes** returns to what the visuals stage made. Changes save as you type to `video/out/event-edits.json`, a line says what will be drawn again ("only that overlay's window"), and the engine applies them on every render. Clicking a blur box on V2 opens it in the viewer instead.
- When you have choices the rough does not have yet, the right of the tool row shows a count ("2 restored · 3 struck · not built yet") with **Start over** (drops every strike and restore, back to the agent's edit list; your Keeps and notes stay) and **Rebuild rough**.

### The Cuts list

The Cuts list is where you review the rough. It starts with **From the agent**: things it asks you to look at, such as a tight join, private text on screen or a quiet stretch, each with a time (click to play from there) and a **Looked at** button to mark it done. Then the cuts:

- **For you**: the cuts the agent flagged as judgment calls, often with a question.
- **The others**: every other cut, in time order.
- **Small pauses**: the small unflagged silences (folded at first).

The head counts them: "34 cuts · 3 flagged · 2 kept · 1 to restore · 1 noted". A card shows the time, the kind (pause, filler, retake, aside, wait, other), the id (`c3`), why it was cut, the kept words around the removed words (struck through), and four buttons:

| button | does |
|---|---|
| **Keep cut** | the cut is right: it stays cut |
| **Restore words** | put the removed words back; they play at once |
| **Note** | write a note on this cut |
| **Before / After** | hear the recording with the words in, then the edit |

Every click and every note is saved at once, and is still there after a reload. A **Restore** of a cut that is not a simple join says so: it comes back when the agent rebuilds the rough. Once the talk is locked, **Keep cut** and **Restore words** do nothing (the list says so) and **Notes** still reach the agent when you send the video back.

Click a card to go to that cut; the flagged cuts are also amber on the timeline. Keys: `↑` and `↓` move, `C` keeps, `R` restores, `N` writes a note, Enter plays the cut's Before and After.

When you press **Approve & lock** or **Send back**, your Keeps, Restores, notes and struck words are written into the notes in plain words.

### The agent panel

The panel shows what the agent does as it happens: its words, and one line per tool it uses (click a line to see the command and its result). The state shows at the top: **Idle**, **Working…**, **Asleep while its task runs** (a long render runs in the background and wakes the agent when it ends) or **Waiting for your answer**.

- **Questions.** When the agent needs you, a card appears: "The agent asks you" with options to pick, or a box to write your own ("Or in your own words…"). Nothing is sent until you press **Send**; Ctrl+Enter in a box sends too. The Answer button on the stage bar, the toast, the orange agent chip and the `(!) Your answer` tab title all point at it. If the agent went on without waiting, the card says so and offers **Send them as a message**.
- **Talk to it.** Type in "Talk to the agent…" (Enter sends, Shift+Enter makes a new line). If it is working, it reads your message between its steps. This uses your Claude subscription like any turn.
- **Stop** stops the turn.
- **Cost and time.** When a turn ends the panel prints "Done" with its time and cost, the same numbers as the stage chip. A time stamp like `1:23` in the agent's text is a link: click it to play the video from there.
- A render the agent started shows as a line "... in the background; the agent sleeps until it ends".
- If a stage shows no output for `quietMinutes` minutes, the app tells you once ("nothing new for 15 min ... It may be stuck: Stop it, or let it run"). It keeps running.

### The visuals proof and the final review

After the rough is locked, the **Visuals** stage dresses it: overlays, punch-ins, captions and sound, from the overlay kit (`kit/templates`). The agent first renders a **proof** (a 540p look at only the overlay windows) and checks it, then the final in the background. You see the result in the viewer's **Final** mode, with overlays on V2 and captions on CC. Fix an overlay yourself in the inspector, draw a blur box, or tell the agent in the panel. A fix renders only what changed ([how-it-works.md](how-it-works.md#overlay-windows-and-chunk-caching)). The **Inspect** stage checks length, the locked voice, frames and text in the safe areas, and its points for you show in **From the agent** and as markers. At **Final review** press **Approve**, or **Send back** (it goes to Visuals; the talk stays locked).

## The Shorts tab

For the recipe **Shorts from a long video** (and any project that has Shorts). At the pick stage the agent reads the whole talk and the tab shows each moment as a 9:16 card:

- the picture, a **play** button that plays only that stretch, the length, the title, the opening line in quotes, and why the agent picked it;
- **Keep** and **Drop**: press again to clear the choice;
- a note box ("A note for the agent ...") that saves as you type.

The head counts "8 picked · 3 kept · 2 dropped". Your choices are saved at once, so the agent can change its list without losing a click. **Cut these (N)** approves your picks and starts cutting the kept ones (it needs at least one kept). After cutting, each card turns into the cut Short: a player, a badge ("cut" or "rough only"), the check result, the points the agent wants you to look at, **Good** or **Redo**, and a note ("What to change in this Short ..."). At the Review stage, **Approve the Shorts** approves them all; if any is marked Redo the button reads "Send back <ids> to cut again", and only those are cut again with your notes.

In an **Edit a video** project the tab offers **Pick Shorts from this edit**: it makes a new Shorts project that reuses this project's rough and words (nothing is transcribed or uploaded again) and opens it. Export each Short on the [Export tab](#the-export-tab).

## The Studio tab

The Studio tab is the packaging room, in pages along its top: **Plan**, **Script**, **Research**, **Titles**, **Thumbnails**, **Feed**, **Upload**. A small badge on a page shows a count or a tick. When the project is at a stage that has a page, a line shows "Now: Titles · waiting for you" and **Show it** jumps there. Everything you type is saved as you type.

- **Plan** and **Script** are text boxes for `studio/plan.md` and `studio/script.md`. The agent writes the plan at the Plan stage; you can write or change it freely.
- **Research**: the videos found for your topic with their **Outlier** score (a video's views against its channel's usual). Filter by title and sort by Outlier, Views or Newest. The patterns the top titles share show above. If nothing is there, **Ask the agent to research** asks it first.
- **Titles**: cards of options. Click a title to edit it (the original stays as "was: ..."); the number is its length in characters. **Pick** chooses it; **☆ To the feed** stars it for the feed test; **Hide** puts it away; a note box talks to the agent. Add your own at the bottom ("Write your own title and press Enter").
- **Thumbnails**: the options at **Big**, **Feed size** or **Phone size**, with how each was made (code, AI picture, or AI background plus code). **Pick**, star, hide and notes work like titles. **Ask the agent for thumbnails** asks it to make them. AI images: [thumbnails-ai-images.md](thumbnails-ai-images.md).
- **Feed**: your starred titles and thumbnails among the real researched videos, as a viewer would see them. **Light** or **Dark**, **Desktop** or **Phone**, **Shuffle**, **Mark mine** (outlines your tiles), and a box for your channel name. Under it, **Your pairs**: **Pick this package** picks that title and thumbnail together.
- **Upload**: the description, tags, **Private** / **Unlisted** / **Public**, an optional schedule (private only), category, audience and the "altered or synthetic content" box. **Before it goes** lists what is still missing, each with a **Go** button. **Dry run** goes through every step against a fake YouTube and uploads nothing. **Upload to YouTube** uploads, asks once more, and works only when you press it. **Connect YouTube** needs your own Google client first: [youtube-upload.md](youtube-upload.md).

Buttons that ask the agent (**Ask the agent to research**, **Ask the agent for thumbnails**) show a confirmation first, because they use your Claude subscription.

## The Export tab

Everything here is made on your computer from the approved edit; nothing is uploaded. Each format has a card with what it is and which programs open it, and a button that makes the file; the file then shows with its size, age and a download link:

| format | button | what you get |
|---|---|---|
| **Video (MP4)** | **Get the video** | the final, or the approved rough before the visuals exist (the card says so) |
| **Subtitles (SRT)** | **Make subtitles** | the video's caption lines, or every spoken word in short lines with fillers left out |
| **Edit list (FCPXML 1.10)** | **Make FCPXML** | the approved cut as a timeline, one clip per kept stretch, linked to your footage; no overlays |
| **Edit list (OpenTimelineIO)** | **Make OTIO** | the same cut as an OpenTimelineIO timeline; no overlays |

A card is greyed out with a line saying what it needs while the file it is made from does not exist yet. Cut Shorts get their own cards under **Shorts (N)**.

## The Context tab

The Context tab shows what the agent reads at each stage, so you can change how it works. It is a map: one column per stage of the recipe (pick the recipe in the **Recipe** menu at the top), and under it the shared things every stage reads: `CLAUDE.md` (the standing instructions), **House rules** and **The brief**.

- A column lists the **Skills** switched on for that stage, the stage's own instructions under **Also reads**, and lines to the shared files. User stages (approvals, recording) show "You decide here". A tag shows where a thing lives: **shipped** (with the app), **yours** (your version in `data/craft/`), **the agent's** (the agent wrote it), or **missing**.
- **Click anything** to read it in the panel on the right, edit it in place and **Save** (or **Discard**). **Reset to default** brings the shipped version back. The day's first version of a file you change is backed up in `data/backups/`.
- **Switch skills per stage.** Under a stage's skills, "+ switch a skill on" adds one; the **×** on a skill switches it off for that stage only. In a skill's panel, tick the stages it is **Switched on for**. **Reset skills to default** on a stage's panel undoes your choice for that stage. A stage's panel also shows the whole message the stage sends the agent.
- **New skill** writes a skill of your own: a name like `cut-my-way`, a short description (the agent reads it first) and the text, and optionally switches it on for a stage. More: [customising.md](customising.md#a-skill).
- **House rules** is the book the agent reads before every stage; it has three parts, *How we cut*, *Tools we use* and *Lessons*. Under **Lessons** are the lessons the agent wrote from your corrections, each with its date, the evidence and two counts, `kept` and `against`. **+ held up** and **+ went wrong** count one more by hand; a lesson judged wrong more often than it held up is marked **up for review**.
- Edits are live: the next stage the agent runs reads the new version.

## The Setup tab

Setup lists everything the studio needs, each with a tick, a cross or a note: Node.js 22+, ffmpeg and ffprobe, Python 3 with numpy and Pillow, uv, the GPU and video encoder (optional), the Claude Code login, free disk space and Remotion. Each row says what was found; a cross or a note also says why it matters and shows the command that fixes it for your system with a **Copy** button, and sometimes a **More help** link. Press **Check again** after you fix something. The app opens on this tab by itself when a required check fails. More: [setup.md](setup.md).

## Settings

There is no settings screen. The settings (model, effort, permission mode and so on) are in `data/settings.json`. Every one is explained in [configuration.md](configuration.md#settings).

## Keyboard shortcuts

Press **?** (or the **?** button) anywhere to see them in the app. The Edit tab's keys work while the Edit tab is open; a text box you are typing in keeps its own keys. On a Mac, Ctrl means Cmd. A key means one thing everywhere.

**Play**

| key | does |
|---|---|
| Space | play / pause |
| J | play backwards (again: faster) |
| K | pause |
| L | play forwards (again: faster) |
| ← and → | one frame back, one frame on |
| Shift+← and Shift+→ | one second back, one second on |
| Home and End | to the start, to the end |
| `\` | Before / After |

**Cuts**

| key | does |
|---|---|
| ↑ and ↓ | previous cut, next cut |
| C | Keep cut: the cut stays, its words stay out |
| R | Restore words: the cut words come back |
| N | a note on the cut (when the Cuts list is the active panel) |
| Enter | hear the cut, Before and After (when the Cuts list is the active panel) |

**Edit**

| key | does |
|---|---|
| I and O | mark In and Out |
| Ctrl+Shift+X | clear In and Out |
| Delete or Backspace | cut the selected words, or In to Out; or delete the picked blur box |
| Shift+Delete | ripple delete In to Out |
| B | blade at the playhead |
| , and . | move the picked join a frame earlier or later |
| Esc | cancel the box you are drawing, or close the overlay inspector |
| Ctrl+Z | undo |
| Ctrl+Shift+Z or Ctrl+Y | redo |

**Timeline**

| key | does |
|---|---|
| = or + | zoom in |
| - | zoom out |
| Shift+Z | fit the whole edit |
| S | snap on / off |
| Ctrl and the mouse wheel | zoom around the pointer |

**Anywhere**

| key | does |
|---|---|
| ? | show the keys |
| Esc | close the keys, a dialog or the project picker |

## On a phone

The server listens on 127.0.0.1 only, so another device on your network cannot open it. In a narrow browser window (under 700 px) the Edit tab shows the viewer on top and one panel at a time under it, chosen from a row of tabs: **Cuts**, **Agent**, **Words**, **Timeline**, **Media**. The Agent tab turns orange while the agent waits for your answer, and **Answer** opens it.
