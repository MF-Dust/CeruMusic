export function getDisplayName(user: any): string {
  return user?.name || user?.username || '用户'
}
export default getDisplayName
