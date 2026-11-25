import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState, PageHeader, Panel } from "@/components/injector/ui";
import { qk, useMe } from "@/hooks/useInjector";
import { apiGet, apiPatch, errorMessage } from "@/lib/api";
import type { UserList } from "@/lib/types";

export default function UsersPage() {
  const qc = useQueryClient();
  const { data: me, isLoading: meLoading } = useMe();
  const isAdmin = me?.role === "admin";
  const { data } = useQuery({ queryKey: qk.users, queryFn: () => apiGet<UserList>("/users"), enabled: isAdmin });

  const setRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: string }) => apiPatch(`/users/${id}/role`, { role }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.users });
      qc.invalidateQueries({ queryKey: qk.me });
      toast.success("Role updated");
    },
    onError: (e) => toast.error(errorMessage(e, "Could not change role")),
  });

  if (!meLoading && !isAdmin)
    return (
      <div>
        <PageHeader kicker="Restricted" title="Users" />
        <EmptyState testId="users-forbidden" title="Admins only" body="Only admins can manage roles." />
      </div>
    );

  return (
    <div>
      <PageHeader kicker="Restricted · Admin" title="Users" />
      <p className="-mt-3 mb-5 text-sm text-zinc-400">Reviewers import, review and export packages. Admins also run direct uploads and publish the Card pending queue.</p>
      <Panel className="divide-y divide-steel" data-testid="users-list">
        {data?.users.map((u) => (
          <div key={u.user_id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between" data-testid={`user-row-${u.user_id}`}>
            <div className="min-w-0">
              <div className="font-semibold text-white">{u.name || u.email || u.user_id}</div>
              <div className="truncate font-mono text-xs text-zinc-400">{u.email || u.user_id}</div>
            </div>
            <Select value={u.role} onValueChange={(role: string) => setRole.mutate({ id: u.user_id, role })}>
              <SelectTrigger className="w-40" data-testid={`user-role-select-${u.user_id}`}>
                <SelectValue>{(v) => String(v)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {data.roles.map((r) => (
                  <SelectItem key={r} value={r} data-testid={`role-option-${r}`}>{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
      </Panel>
    </div>
  );
}
