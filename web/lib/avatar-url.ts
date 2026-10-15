/** Where a person's picture is served from (plan 05zs). `version` busts the browser cache when the picture changes. */
export const avatarUrl = (userId: string, version: number | null): string | undefined =>
  version === null ? undefined : `/api/avatar/${userId}?v=${version}`;
