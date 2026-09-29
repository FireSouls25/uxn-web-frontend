/* Agent provider configuration. The concrete Pi SDK (package,
   model ids, tool-calling support) is still open — see
   backend/rag/agent-contract.md. Until it lands, this list is the
   integration point: entries come from PUBLIC_AGENT_PROVIDERS
   (comma-separated "id:label") or stay empty, and the chat shows its
   offline state honestly instead of faking a model. */

export interface AgentProvider {
  id: string;
  label: string;
}

function fromEnv(): AgentProvider[] {
  const raw =
    (import.meta.env.PUBLIC_AGENT_PROVIDERS as string | undefined) ?? "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const [id, ...rest] = entry.split(":");
      return { id, label: rest.join(":") || id };
    });
}

export const AGENT_PROVIDERS: AgentProvider[] = fromEnv();
export const AGENT_ENDPOINT =
  (import.meta.env.PUBLIC_AGENT_ENDPOINT as string | undefined) ?? "/agent/chat";
