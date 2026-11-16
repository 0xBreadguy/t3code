# Roles and models

Roles let you give T3-managed delegated work a different model and a standing
standard of work. Configure them in **Settings → Threads → Roles & models**. Your
own threads and a provider's own subagents do not use these settings.

## What a role does

Each role has a model and its options, such as reasoning effort, plus a
delegation mode and optional instructions. All of it applies only to work T3
launches through `delegate_task` with that role. A review or test model does not
run anything by itself.

The roles are architecture, implementation, research, review, security, design,
test, and general. T3 includes built-in instructions for each role and applies
them when it launches a child with that role.

Delegation guidance is opt-in: T3 adds no role catalog until you give at least
one role a model. Until then the thread behaves as before, including your
provider's own subagents under the usual rules; T3 adds no role routing. Once a
role has a model, each top-level thread carries a compact catalog of the roles
you configured, and the agent checks it before deciding to work directly. Then
it routes matching work through T3 so the role's model and instructions apply.

Each configured role also has a delegation mode:

- **Prefer** (the default) is a preference: the agent prefers delegating
  substantive, scoped work and handles simple questions and small, contained
  changes in the thread.
- **Always** requires actual matching work to go through the role, even when the
  agent could do it quickly itself. A passing mention or a quick question is not
  matching work.

For example, **Always** on Security makes a real security review use that role,
while a docs line that mentions security or a question about a header still
stays in the thread.

Your own instruction still wins. Naming a provider or model explicitly overrides
the role's model selection; the role's instructions still apply. Specifying only
options refines the role's configured model. A user who asks to do the work
directly keeps it in that thread, including for an always role, and a user who
asks for native tooling gets a native subagent instead of a T3-delegated one.

A delegated child gets no catalog and finishes its own task instead of delegating
again. Side chats and native subagents do not get the catalog either; without
one, the ordinary rules apply, so a side chat still delegates when you ask.

## Scopes

Roles are environment-wide by default. A project can override a role's model,
mode, or instructions without changing the environment default, and anything it
does not override keeps inheriting. In an all-environments scope, a save writes
the same roles to every selected environment; it does not link them, and a later
change on one environment stays there.

On a project, a value it inherits has a dashed outline; a value set on the
project is solid and has a reset icon that makes it inherit again.

## Instructions

Instructions are stored exactly as typed, including leading, trailing, and blank
lines. An empty value disables the extra block for that role; a role with no
value at any scope inherits the scope above it and finally the built-in text.

Instructions or a delegation mode alone do not turn delegation on; give at least
one role a model to get the catalog.

In a project scope, only roles you set are written. Saving one role never erases
another, and **Reset** removes an override so the role inherits again. When a save
fails, the editor keeps your text so you can retry.

A model change applies to the next launch. A conversation that is already running
keeps its model, and a delegated worker keeps the instructions it launched with.

## Unavailable models

If a configured role names a provider or model the server does not offer, the
launch fails with that reason. T3 does not substitute another model silently. Fix
the role in settings or name a model explicitly in the request.

Servers older than the security role drop that role from a save instead of
failing the other roles. Delegation modes need a server that supports them: on an
older server the mode control is unavailable and T3 does not save a mode there,
so update T3 Code on that server before setting one. Section settings show the
reason when the target server cannot store a role or mode.
