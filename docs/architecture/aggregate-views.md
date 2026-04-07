# Aggregate Views Architecture

> Browse panes across sessions without materializing every PTY in the background.

## Current Model

The aggregate view is a fullscreen overlay with two jobs:

1. show a stable cross-session list of panes
2. let the user preview or jump into the selected pane quickly

The key design choice is that the aggregate list is **snapshot-first**.

### Source of truth

- **Active session**: current in-memory layout state
- **Other sessions**: persisted session workspace snapshots on disk
- **Live PTY metadata**: an overlay on top of those snapshots

That means the aggregate list is anchored to session workspaces, not to a global scan of live PTYs.

## Why snapshot-first?

Earlier versions leaned too hard on global live PTY discovery. That made the aggregate list look dynamic, but it also caused subtle correctness bugs:

- PTYs bleeding between sessions
- ghost rows for panes that did not exist in any visible workspace
- wrong git metadata following the wrong row
- unloaded sessions materializing PTYs in the background
- unstable selection and preview behavior during fast switching

The current model prefers correctness and stable identity:

- `sessionId + paneId` is the durable row identity
- live PTYs replace saved rows when available
- unloaded sessions stay unloaded until the user actually switches to them

## High-level flow

```text
Persisted session snapshots + active in-memory layout
                    │
                    ▼
          Aggregate snapshot refresh
                    │
                    ▼
      Stable rows keyed by sessionId + paneId
                    │
     ┌──────────────┼──────────────┐
     ▼              ▼              ▼
 live metadata   optimistic UI   activity overlay
   overlay        placeholders    (shimmer)
```

## Important behaviors

### 1. No background PTY materialization

Browsing unloaded sessions must not create hidden PTYs.

Aggregate selection can show:

- saved rows from persisted workspaces
- optimistic `...` placeholders for in-flight pane creation
- live PTYs for the active or resumed session

But it must **not** wake up an unloaded session just because the cursor moved over it.

### 2. Preview resolves saved rows back to the live PTY

A selected row may still be represented by a saved id such as:

```text
saved:<sessionId>:<paneId>
```

When that session becomes active, preview logic resolves the row back through the live workspace layout to find the real PTY for that pane. This keeps preview rendering, keyboard input, focus tracking, and copy/search mode aligned with the same live target.

### 3. Optimistic UI is layered on top of snapshots

The aggregate view still keeps the responsive behavior we want:

- queued `...` placeholders appear immediately for new panes
- saved rows are claimed by the first matching live PTY for the pane
- closing a pane removes the row immediately
- pane ordering survives refreshes instead of being rebuilt from scratch every time

The important part is that this optimism is a thin layer on top of stable session-workspace data.

### 4. Activity and shimmer are tracked by pane identity

Shimmer is now a hybrid overlay:

- we subscribe once to cheap global PTY activity events
- live activity is mirrored onto the stable saved-row id for the owning `sessionId + paneId`
- saved rows can keep shimmering across session boundaries without loading every PTY

This keeps activity visible in the aggregate list while avoiding the bugs that came from globally hydrating every background PTY.

## Session switching behavior

Aggregate-driven session switches are:

- **serialized**
- **latest-wins**
- targeted to the selected pane's workspace when known

That prevents older async switches from racing and restoring the wrong session after the user has already moved on.

## Main modules

### UI

- `src/components/AggregateView.tsx`
  - composition root for the overlay
- `src/components/aggregate/ListPane.tsx`
  - session + pane tree rendering
- `src/components/aggregate/PreviewPane.tsx`
  - preview container and border state
- `src/components/aggregate/InteractivePreview.tsx`
  - live terminal preview

### Preview and interaction helpers

- `src/components/aggregate/hooks/useAggregatePreviewSupport.ts`
  - shared preview PTY resolution, emulator lookup, and activity subscription wiring
- `src/components/aggregate/keyboard/preview.ts`
  - preview input routing
- `src/components/aggregate/utils.ts`
  - pane lookup, preview resolution, and ownership resolution helpers

### Aggregate state

- `src/contexts/AggregateViewContext.tsx`
  - context wiring and refresh/subscription setup
- `src/contexts/aggregate/refresh.ts`
  - snapshot rebuild and live metadata overlay
- `src/contexts/aggregate/subscriptions.ts`
  - lifecycle/title/activity-driven updates
- `src/contexts/aggregate/session.ts`
  - selection preservation and tree recomputation
- `src/contexts/aggregate/rows.ts`
  - saved/pending row identities and pane-key dedupe helpers

## Invariants worth protecting

When changing aggregate behavior, keep these rules intact:

1. **Session workspaces are the source of truth**
2. **`sessionId + paneId` is the stable row identity**
3. **Do not materialize PTYs just by browsing unloaded sessions**
4. **Preview/input/focus must all resolve through the same live PTY target**
5. **Optimistic placeholders must never duplicate a claimed live pane**
6. **Wrong metadata is worse than blank metadata**

## Testing focus

The most important regressions to cover are:

- fast cross-session navigation (`opt+j/k`)
- saved-row → live-row replacement preserving selection and preview
- background activity updating shimmer on saved rows
- switching to a previewed PTY and typing immediately
- pane creation placeholders being claimed instead of duplicated
- deleted PTYs not reviving during refresh

## Future possibilities

There is still room to build richer aggregate queries later, but those features should preserve the same invariants above. New filtering or grouping features should compose with the snapshot-first row model rather than replacing it with a live-PTY-global-source model again.
