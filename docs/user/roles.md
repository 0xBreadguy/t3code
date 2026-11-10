# Roles and models

Roles let you give T3-managed delegated work a different model and a standing
standard of work. Configure them in **Settings → Threads → Roles & models**. Your
own threads and a provider's own subagents do not use these settings.

## What a role does

Each role has a model and its options, such as reasoning effort. You can also add
instructions. Both apply only to work T3 launches through `delegate_task` with
that role. A review or test model does not run anything by itself.

The roles are architecture, implementation, research, review, security, design,
test, and general. T3 includes built-in instructions for each role and applies
them when it launches a child with that role.

When a project has any role configured, a normal thread's turn includes a compact
catalog of the roles. The agent chooses a role from the task and delegates
through T3 so the configured model and instructions apply. Naming a provider or
model explicitly overrides the role's model selection; the role's instructions
still apply. Specifying only options refines the role's configured model.

## Scopes

Roles are environment-wide by default. A project can override any role without
changing the environment default, and a role it does not override keeps
inheriting. In an all-environments scope, a save writes the same roles to every
selected environment; it does not link them, and a later change on one
environment stays there.

## Instructions

Instructions are stored exactly as typed, including leading, trailing, and blank
lines. An empty value disables the extra block for that role; a role with no
value at any scope inherits the scope above it and finally the built-in text.

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
failing the other roles. Section settings show the reason when the target server
cannot store a role.
