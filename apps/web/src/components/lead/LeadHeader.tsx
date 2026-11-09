import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { LeadScope } from "@t3tools/client-runtime/lead/scope";
import { ChevronDownIcon, Maximize2Icon, Minimize2Icon, XIcon } from "lucide-react";

import { useEnvironment, useEnvironments } from "../../state/environments";
import { useProjects } from "../../state/entities";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export function LeadHeader({
  scope,
  projectLabel,
  status,
  expanded,
  onSwitch,
  onExpand,
  onClose,
}: {
  readonly scope: LeadScope;
  readonly projectLabel: string;
  readonly status: string;
  readonly expanded: boolean;
  readonly onSwitch: (scope: LeadScope) => void;
  readonly onExpand: () => void;
  readonly onClose: () => void;
}) {
  const projects = useProjects();
  const environment = useEnvironment(scope.environmentId);
  const { environments } = useEnvironments();
  const environmentLabel = new Map(environments.map((entry) => [entry.environmentId, entry.label]));
  return (
    <div className="flex items-center gap-1.5 border-b border-border/70 px-2 py-1.5">
      <Menu>
        <MenuTrigger
          render={<Button size="xs" variant="ghost" className="min-w-0" />}
          aria-label={`Lead for ${projectLabel} on ${environment?.label ?? "this environment"}. Change project`}
        >
          <span className="truncate">{projectLabel}</span>
          <ChevronDownIcon className="size-3.5 shrink-0" />
        </MenuTrigger>
        <MenuPopup align="start" width="content" side="bottom">
          {projects.map((project) => {
            const projectScope = scopeProjectRef(project.environmentId, project.id);
            const selected =
              projectScope.environmentId === scope.environmentId &&
              projectScope.projectId === scope.projectId;
            return (
              <MenuItem
                key={`${project.environmentId}:${project.id}`}
                onClick={() => onSwitch(projectScope)}
              >
                <span className="flex min-w-0 flex-1 items-center justify-between gap-4">
                  <span className="truncate">{project.title}</span>
                  <span className="shrink-0 text-2xs text-muted-foreground">
                    {environmentLabel.get(project.environmentId) ?? project.environmentId}
                  </span>
                </span>
                {selected ? <span className="sr-only">Selected</span> : null}
              </MenuItem>
            );
          })}
        </MenuPopup>
      </Menu>
      <Badge size="sm" variant="secondary" className="shrink-0">
        {status}
      </Badge>
      <div className="ms-auto flex items-center gap-0.5">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={expanded ? "Collapse lead" : "Expand lead"}
                onClick={onExpand}
              />
            }
          >
            {expanded ? <Minimize2Icon /> : <Maximize2Icon />}
          </TooltipTrigger>
          <TooltipPopup side="bottom">{expanded ? "Collapse lead" : "Expand lead"}</TooltipPopup>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button size="icon-xs" variant="ghost" aria-label="Close lead" onClick={onClose} />
            }
          >
            <XIcon />
          </TooltipTrigger>
          <TooltipPopup side="bottom">Close lead</TooltipPopup>
        </Tooltip>
      </div>
    </div>
  );
}
