// Its own module: the header next door pulls in server-only code, which must
// not reach the browser bundle through a client component's import.
export function PageBody({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`flex-1 overflow-y-auto p-4 sm:p-6 ${className}`}>{children}</div>;
}
