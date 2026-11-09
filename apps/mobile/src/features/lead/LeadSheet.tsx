import {
  leadScopeKey,
  resolveLeadOpenScope,
  type LeadContinuity,
} from "@t3tools/client-runtime/lead/scope";
import type { LeadPageContext } from "@t3tools/client-runtime/lead/context";
import {
  EnvironmentId,
  ProjectId,
  ThreadId,
  type AgentRoleModelSelections,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { StackActions, useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { useAtomValue } from "@effect/atom-react";
import { useEffect, useState } from "react";
import { Keyboard, Platform, Pressable, ScrollView, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";

import { AppText as Text } from "../../components/ui/AppText";
import { SymbolView } from "../../components/ui/AppSymbol";
import { Button } from "../../components/ui/Button";
import { ScreenContent } from "../../components/ui/ScreenContent";
import { SheetHeader } from "../../components/ui/SheetHeader";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { useEnvironments } from "../../state/environments";
import { useProject, useProjects, useQuietThreadShell, useThreadShell } from "../../state/entities";
import { leadEnvironment } from "../../state/lead";
import { openSettings } from "../settings/settings-navigation";
import { useAdaptiveWorkspaceLayout } from "../layout/AdaptiveWorkspaceLayout";
import { LeadComposer } from "./LeadComposer";
import { LeadConversation } from "./LeadConversation";
import { LeadPending } from "./LeadPending";
import { LeadWork } from "./LeadWork";
import { setRetainedLeadScope, useRetainedLeadScope } from "./leadScopeState";
import {
  deriveLeadSheetStatus,
  leadModelSummary,
  leadRoleRows,
  leadRoleSource,
} from "./leadPresentation";
import { useLeadSheetContentHeight } from "./leadSheetLayout";
import { useLeadLiveState } from "./useLeadLiveState";
import { leadThreadRef, useLeadRunning, useLeadSession } from "./useLeadSession";

export type LeadSheetParams = {
  readonly environmentId?: string;
  readonly projectId?: string;
  readonly threadId?: string;
};

export function LeadSheet({ route }: StaticScreenProps<LeadSheetParams>) {
  const navigation = useNavigation();
  const { layout } = useAdaptiveWorkspaceLayout();
  const params = route.params ?? {};
  const { presentationById } = useEnvironments();
  const environmentId = params.environmentId ? EnvironmentId.make(params.environmentId) : null;
  const threadId = params.threadId ? ThreadId.make(params.threadId) : null;
  const paramProjectId = params.projectId ? ProjectId.make(params.projectId) : null;
  const pageThreadRef: ScopedThreadRef | null =
    environmentId !== null && threadId !== null ? { environmentId, threadId } : null;
  const pageThread = useThreadShell(pageThreadRef);
  const pageScope =
    environmentId === null
      ? null
      : pageThread !== null
        ? { environmentId, projectId: pageThread.projectId }
        : paramProjectId !== null
          ? { environmentId, projectId: paramProjectId }
          : null;
  const pageContext: LeadPageContext | null =
    pageThreadRef === null
      ? pageScope === null
        ? null
        : { scope: pageScope }
      : {
          scope: pageScope,
          thread: {
            ref: pageThreadRef,
            title: pageThread?.title.trim() || "Current thread",
          },
        };

  const retainedScope = useRetainedLeadScope();
  const resolved = resolveLeadOpenScope({ retained: retainedScope, page: pageScope });
  const scope = resolved.scope;
  const session = useLeadSession(scope);
  const project = useProject(
    scope === null ? null : scopeProjectRef(scope.environmentId, scope.projectId),
  );
  const projectLabel = project?.title ?? "Project";
  const canOperate = useAtomValue(
    leadEnvironment.send.permissionAtom(scope?.environmentId ?? null),
  );
  const canWriteSettings = useAtomValue(
    leadEnvironment.grant.permissionAtom(scope?.environmentId ?? null),
  );
  const sheetLayout = useLeadSheetContentHeight();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sentThread, setSentThread] = useState<{
    readonly scopeKey: string;
    readonly threadId: ThreadId;
  } | null>(null);

  const scopeKey = scope === null ? null : leadScopeKey(scope);
  const pendingThreadId =
    sentThread !== null && sentThread.scopeKey === scopeKey ? sentThread.threadId : null;
  const threadRef = leadThreadRef(scope, session.data, pendingThreadId);
  const running = useLeadRunning(threadRef);
  const leadShell = useQuietThreadShell(threadRef);
  const needsYou =
    leadShell !== null && (leadShell.hasPendingApprovals || leadShell.hasPendingUserInput);
  const live = useLeadLiveState(scope, session.data);
  const liveData =
    session.data === null
      ? null
      : {
          ...session.data,
          state: live.state,
          pendingHandoffCount: live.pendingHandoffCount,
        };
  const status = deriveLeadSheetStatus({
    capability: session.capability,
    online: session.online,
    needsYou,
    running,
    ownership: live.state?.ownership ?? null,
    reportsToReview: live.pendingHandoffCount,
  });
  const settings =
    scope === null
      ? null
      : (presentationById.get(scope.environmentId)?.serverConfig?.settings ?? null);
  const projectRoleModels: AgentRoleModelSelections | undefined =
    scope === null
      ? undefined
      : settings?.projectSettingsOverrides[scope.projectId]?.agentRoleModels;
  const environmentRoleModels: AgentRoleModelSelections | undefined = settings?.agentRoleModels;
  const capabilityReason =
    scope === null
      ? null
      : session.capability.kind === "unsupported"
        ? session.capability.reason
        : session.capability.kind === "offline" || !session.online
          ? `Can't reach ${session.label}. Your draft stays here.`
          : null;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- remembers the first scope opened so reopening resumes it
  useEffect(() => {
    if (retainedScope === null && scope !== null) setRetainedLeadScope(scope);
  }, [retainedScope, scope]);

  const close = () => navigation.goBack();
  const pickScope = (next: { environmentId: EnvironmentId; projectId: ProjectId }) => {
    setRetainedLeadScope(next);
    setPickerOpen(false);
  };
  const openThread = (ref: ScopedThreadRef) => {
    // Replace the sheet so the worker enters the workspace stack its Back button expects.
    navigation.dispatch(
      StackActions.replace("Thread", {
        environmentId: String(ref.environmentId),
        threadId: String(ref.threadId),
      }),
    );
  };

  const picker =
    scope === null || pickerOpen ? (
      <LeadProjectPicker
        currentScope={scope}
        onPick={pickScope}
        onCancel={scope === null ? null : () => setPickerOpen(false)}
      />
    ) : null;

  const body = (
    <KeyboardAvoidingView automaticOffset behavior="padding" className="flex-1">
      <View className="flex-1">
        {capabilityReason !== null ? (
          <View className="gap-1.5 border-b border-border bg-card-alt px-4 py-2.5">
            <Text accessibilityRole="alert" className="text-sm text-foreground-secondary">
              {capabilityReason}
            </Text>
            {session.capability.kind === "unsupported" && scope !== null ? (
              <Button
                label="Open environment settings"
                tone="text"
                onPress={() =>
                  openSettings(navigation, "SettingsEnvironmentDetail", {
                    environmentId: scope.environmentId,
                  })
                }
              />
            ) : null}
          </View>
        ) : null}
        {session.error !== null ? (
          <View className="flex-row items-center gap-2 px-4 py-2">
            <Text
              accessibilityRole="alert"
              className="min-w-0 shrink text-sm text-danger-foreground"
            >
              {session.error}
            </Text>
            <Button label="Retry" tone="text" onPress={session.refresh} />
          </View>
        ) : null}
        {scope !== null && picker === null ? (
          <LeadScopeHeader
            projectLabel={projectLabel}
            environmentLabel={session.label}
            onOpenPicker={() => {
              Keyboard.dismiss();
              setPickerOpen(true);
            }}
          />
        ) : null}
        {scope !== null && picker === null ? (
          <LeadContinuityBar continuity={resolved.continuity} scope={scope} onSwitch={pickScope} />
        ) : null}
        {scope === null || picker !== null ? (
          picker
        ) : (
          <>
            <LeadPending
              threadRef={threadRef}
              environmentId={scope.environmentId}
              online={session.online}
            />
            <LeadConversation
              threadRef={threadRef}
              environmentId={scope.environmentId}
              projectId={String(scope.projectId)}
              emptyCopy={
                capabilityReason !== null
                  ? "The lead isn't available here yet. Your draft stays here."
                  : liveData === null || liveData.binding === null
                    ? `Ask about work in ${projectLabel}. The lead observes and recommends. ` +
                      "It acts on what you ask here; broader or unattended work needs you to hand over ownership."
                    : liveData.state == null || liveData.state.handoffs.length === 0
                      ? "Nothing handed back yet. Workers report here when they finish."
                      : "Ask the lead what to do next."
              }
              header={
                <LeadWorkHeader
                  scope={scope}
                  data={liveData}
                  projectRoleModels={projectRoleModels}
                  environmentRoleModels={environmentRoleModels}
                  projectLabel={projectLabel}
                  capabilityReason={capabilityReason}
                  canSend={canOperate && session.online}
                  canWriteSettings={canWriteSettings}
                  onChanged={session.refresh}
                  onOpenThread={openThread}
                />
              }
              onOpenThread={openThread}
            />
            <LeadComposer
              scope={scope}
              page={pageContext}
              projectLabel={projectLabel}
              session={session}
              threadRef={threadRef}
              running={running}
              onSent={(sentThreadId) => {
                if (scopeKey !== null) setSentThread({ scopeKey, threadId: sentThreadId });
                session.refresh();
              }}
            />
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  );

  if (Platform.OS === "ios") {
    return (
      <View collapsable={false} className="flex-1 bg-sheet">
        <SheetHeader
          presentation="native"
          title={`${scope === null ? "Project" : projectLabel} lead`}
          subtitle={scope === null ? "Pick a project" : status.label}
          onClose={close}
        />
        {body}
      </View>
    );
  }

  return (
    <View collapsable={false} className="flex-1 bg-sheet" onLayout={sheetLayout.onLayout}>
      <NativeStackScreenOptions options={{ sheetCornerRadius: 28 }} />
      <View style={{ height: sheetLayout.height }} className="bg-sheet">
        <SheetHeader
          title={`${scope === null ? "Project" : projectLabel} lead`}
          subtitle={scope === null ? "Pick a project" : status.label}
          accessibilityLabel="Close lead"
          onClose={close}
        />
        <ScreenContent insetHorizontal={layout.usesSplitView}>{body}</ScreenContent>
      </View>
    </View>
  );
}

function LeadScopeHeader(props: {
  readonly projectLabel: string;
  readonly environmentLabel: string;
  readonly onOpenPicker: () => void;
}) {
  return (
    <View className="flex-row items-center gap-2 border-b border-border px-4 py-2">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Lead for ${props.projectLabel} on ${props.environmentLabel}. Change project`}
        onPress={props.onOpenPicker}
        className="min-w-0 flex-row items-center gap-1 active:opacity-70"
      >
        <Text numberOfLines={1} className="min-w-0 shrink font-t3-medium text-sm">
          {props.projectLabel}
        </Text>
        <Text className="shrink-0 text-xs text-foreground-muted">· {props.environmentLabel}</Text>
        <SymbolView
          name="chevron.down"
          size={11}
          tintColorClassName="accent-icon-subtle"
          type="monochrome"
        />
      </Pressable>
    </View>
  );
}

function LeadContinuityBar(props: {
  readonly continuity: LeadContinuity;
  readonly scope: { readonly environmentId: EnvironmentId; readonly projectId: ProjectId };
  readonly onSwitch: (scope: { environmentId: EnvironmentId; projectId: ProjectId }) => void;
}) {
  const continuity = props.continuity;
  const { environmentLabel, pageProject, pageEnvironmentLabel, scopeProject } =
    useLeadContinuityLabels(continuity, props.scope);
  if (continuity.kind === "none") return null;
  const copy =
    continuity.kind === "no-project"
      ? `Continuing ${scopeProject}. This page isn't in a project.`
      : continuity.kind === "other-project"
        ? `Continuing ${scopeProject}. You're viewing ${pageProject}.`
        : `Continuing ${scopeProject} on ${environmentLabel}. You're viewing it on ${pageEnvironmentLabel}.`;
  return (
    <View className="flex-row flex-wrap items-center gap-2 border-b border-border bg-card-alt px-4 py-2">
      <Text className="min-w-0 shrink text-xs text-foreground-secondary">{copy}</Text>
      {continuity.kind === "no-project" ? null : (
        <Button label="Switch" tone="text" onPress={() => props.onSwitch(continuity.page)} />
      )}
    </View>
  );
}

function useLeadContinuityLabels(
  continuity: LeadContinuity,
  scope: { readonly environmentId: EnvironmentId; readonly projectId: ProjectId },
) {
  const scopeProject = useProject(scopeProjectRef(scope.environmentId, scope.projectId));
  const page =
    continuity.kind === "other-project" || continuity.kind === "other-environment"
      ? continuity.page
      : null;
  const pageProjectModel = useProject(
    page === null ? null : scopeProjectRef(page.environmentId, page.projectId),
  );
  const { presentationById } = useEnvironments();
  return {
    scopeProject: scopeProject?.title ?? "another project",
    pageProject: pageProjectModel?.title ?? "another project",
    environmentLabel:
      presentationById.get(scope.environmentId)?.entry.target.label ?? "its environment",
    pageEnvironmentLabel:
      page === null
        ? "another environment"
        : (presentationById.get(page.environmentId)?.entry.target.label ?? "another environment"),
  };
}

function LeadProjectPicker(props: {
  readonly currentScope: {
    readonly environmentId: EnvironmentId;
    readonly projectId: ProjectId;
  } | null;
  readonly onPick: (scope: { environmentId: EnvironmentId; projectId: ProjectId }) => void;
  readonly onCancel: (() => void) | null;
}) {
  const projects = useProjects();
  const { environments } = useEnvironments();
  const environmentLabel = new Map(
    environments.map((environment) => [environment.environmentId, environment.label]),
  );
  return (
    <ScrollView
      className="flex-1"
      keyboardShouldPersistTaps="handled"
      contentContainerClassName="gap-0.5 px-3 py-2"
    >
      <View className="flex-row items-center gap-2 px-2 py-2">
        <Text className="font-t3-medium text-sm text-foreground">Which project?</Text>
        {props.onCancel !== null ? (
          <View className="ml-auto">
            <Button label="Back" tone="text" onPress={props.onCancel} />
          </View>
        ) : null}
      </View>
      {projects.length === 0 ? (
        <Text className="px-2 py-3 text-sm text-foreground-muted">
          Add a project first. Each project gets its own lead.
        </Text>
      ) : (
        projects.map((project) => {
          const selected =
            props.currentScope !== null &&
            props.currentScope.environmentId === project.environmentId &&
            props.currentScope.projectId === project.id;
          return (
            <Pressable
              key={`${project.environmentId}:${project.id}`}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={`${project.title} on ${environmentLabel.get(project.environmentId) ?? project.environmentId}`}
              onPress={() =>
                props.onPick({ environmentId: project.environmentId, projectId: project.id })
              }
              className="flex-row items-center gap-3 rounded-xl px-2 py-3 active:bg-subtle"
            >
              <Text numberOfLines={1} className="min-w-0 shrink text-base text-foreground">
                {project.title}
              </Text>
              <Text className="ml-auto shrink-0 text-xs text-foreground-muted">
                {environmentLabel.get(project.environmentId) ?? project.environmentId}
              </Text>
            </Pressable>
          );
        })
      )}
    </ScrollView>
  );
}

function LeadWorkHeader(props: {
  readonly scope: { readonly environmentId: EnvironmentId; readonly projectId: ProjectId };
  readonly data: ReturnType<typeof useLeadSession>["data"];
  readonly projectRoleModels: AgentRoleModelSelections | undefined;
  readonly environmentRoleModels: AgentRoleModelSelections | undefined;
  readonly projectLabel: string;
  readonly capabilityReason: string | null;
  readonly canSend: boolean;
  readonly canWriteSettings: boolean;
  readonly onChanged: () => void;
  readonly onOpenThread: (ref: ScopedThreadRef) => void;
}) {
  const [rolesOpen, setRolesOpen] = useState(false);
  const data = props.data;
  const roles = data === null ? [] : leadRoleRows(data.roleModels);
  if (data === null) return null;
  return (
    <View className="gap-2.5 border-b border-border pb-3">
      <View className="gap-1 rounded-2xl border border-border bg-card-alt px-3 py-2.5">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Roles & models"
          accessibilityState={{ expanded: rolesOpen }}
          onPress={() => setRolesOpen((open) => !open)}
          className="flex-row items-center justify-between gap-2"
        >
          <Text className="font-t3-medium text-sm text-foreground">Roles & models</Text>
          <Text className="text-xs text-foreground-muted">{rolesOpen ? "Hide" : "Show"}</Text>
        </Pressable>
        <Text className="text-xs text-foreground-secondary">
          {leadModelSummary({
            thread: data?.thread ?? null,
            roleModel: data?.roleModels.lead,
          })}
        </Text>
        {rolesOpen ? (
          <>
            <Text className="text-2xs text-foreground-muted">
              Effective roles for this project on this environment.
            </Text>
            {roles.map((role) => {
              const source = leadRoleSource({
                role: role.role,
                projectRoles: props.projectRoleModels,
                environmentRoles: props.environmentRoleModels,
              });
              return (
                <Text key={role.role} className="text-xs text-foreground-secondary">
                  {`${role.role}: ${role.model}${source === null ? "" : ` · ${source === "project" ? "Project role" : "Environment role"}`}`}
                </Text>
              );
            })}
            <Text className="text-2xs text-foreground-muted">
              If a role's model isn't available, T3 asks before launching. It never swaps models
              silently. A model you pick for one task wins for that task. Subagents a provider
              starts on its own may not follow these roles.
            </Text>
            <Text className="text-2xs text-foreground-muted">
              Roles are saved per environment and aren't synced across them. Edit roles in Settings
              on desktop or web.
            </Text>
          </>
        ) : null}
      </View>

      <LeadWork
        scope={props.scope}
        data={data}
        capabilityReason={props.capabilityReason}
        canSend={props.canSend}
        canWriteSettings={props.canWriteSettings}
        projectLabel={props.projectLabel}
        onChanged={props.onChanged}
        onOpenThread={props.onOpenThread}
      />
    </View>
  );
}
