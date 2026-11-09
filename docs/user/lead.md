# Project lead

A project lead is an ordinary T3 Code thread that watches the work its workers hand back for one project. It is not a separate page or sidebar destination. Each environment owns its own lead bindings, so a project on two machines has one lead per machine.

## Summon the lead

- Select **Lead** in the thread header, or use the **Ask the lead** command in the command palette.
- The default shortcut is <kbd>Mod</kbd>+<kbd>I</kbd>. With text selected in the rich-text composer, the same chord italicizes instead. You can rebind it in **Settings › Keybindings**.
- Every invocation opens the compact lead first. **Expand** continues the same conversation in a dock or sheet; closing the surface never stops a reply or running work.

The worker's thread stays mounted while the lead is open. Your worker draft, caret, and scroll position are left alone. If a project has no lead model yet, the panel offers **Choose model** before the first message; it never substitutes one.

## Scope and drafts

The lead is scoped to one environment and project. Invoking it again resumes that scope, even while you are viewing a different project; a continuity bar shows what you are viewing and offers an explicit switch. Each scope keeps its own draft. Nothing moves a draft, message, or reply to another project.

## Reports and ownership

Workers may record a handoff when they finish. A report names the source thread and any commit it could resolve, and lists the checks the worker says it ran. Those checks are reports, not verified results; a normal turn ending is not a handoff. **Review pending work** sends the lead an explicit request to read the reports and recommend what to combine. **Reconcile as recommended** is the same kind of explicit user request: the lead combines the work on a separate branch and runs checks. It needs no standing ownership grant and no extra confirmation, and it does not open a pull request or publish.

The lead observes and recommends by default. **Hand over authority** is a deliberate user action with a readback; it is persisted, visible, and revocable with **Take back**. A grant is for broader or future work the lead should handle without asking each time; it is not required for an action you request in this conversation. A grant covers reconcile, pull request, or merge actions, but it does not sandbox shell commands, undo earlier work, or prove that a merge happened. Provider permissions remain separate. There is no automatic background recommendation pass in this version.

## Roles & models

Lead and other agent roles are edited in **Settings › Threads › Roles & models**, scoped to an environment or project. Open the same view from the lead header to see the resolved models and their source. Project role overrides are sparse: a role with no override inherits the environment's role. **All environments** writes the chosen roles to each selected environment; it does not link or sync them.

A configured model that is unavailable fails the launch instead of silently using another model. A conversation that is already running keeps its model; role changes apply to future launches. A review or test role selects a model but does not run a review, so worker check reports stay unverified until you review them. T3-managed work such as delegated tasks follows these roles; a provider's own subagents may not.

## Context

The lead receives semantic context chips, not a screenshot or a reading of your screen. On a thread page it attaches the current thread; you can remove a chip and re-attach it before sending. The chips attached to a sent message stay visible under that message. A chip that points at another machine is marked unreadable and must be removed before sending. File and diff-selection chips appear only where the page already exposes that selection.

## Limits

Lead conversations are hidden from the sidebar, thread counts, and thread switcher. They remain reachable through the lead surfaces. If a server predates the lead, the surface says it needs an update and keeps your draft.
