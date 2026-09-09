"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { QueryMessage } from "@/components/query-message";
import { PageHeader } from "@/components/ui/stat-card";
import { useEmployees, usePositions } from "@/lib/api/hooks";

export default function PositionsPage() {
  const positions = usePositions(); const employees = useEmployees();
  return <><PageHeader title="职位与权限" description="职位默认权限来自 Supabase" /><QueryMessage loading={positions.isLoading || employees.isLoading} error={positions.error || employees.error} empty={!positions.data?.length} /><div className="grid gap-4 md:grid-cols-2">{positions.data?.map((position) => { const count = employees.data?.filter((employee) => employee.user_positions.some((item) => item.position?.id === position.id)).length ?? 0; return <Card key={position.id}><CardHeader title={`${position.name}（${count}人）`} /><CardContent><div className="flex flex-wrap gap-2">{position.default_permissions.map((permission) => <Badge key={permission} tone="indigo">{permission}</Badge>)}</div></CardContent></Card>; })}</div></>;
}
