"use client";

import { LogOut } from "lucide-react";
import { useSession, signOut } from "@/lib/auth-client";
import { useRouter } from "next/navigation";

export function UserProfile() {
  const { data: session, isPending } = useSession();
  const router = useRouter();

  if (isPending) {
    return (
      <div className="flex items-center gap-3 px-2 py-2 animate-pulse">
        <div className="w-8 h-8 rounded-full bg-secondary/80"></div>
        <div className="flex-1 space-y-2">
          <div className="h-3 bg-secondary/80 rounded w-20"></div>
          <div className="h-2 bg-secondary/80 rounded w-24"></div>
        </div>
      </div>
    );
  }

  if (!session?.user) return null;

  return (
    <div className="flex items-center gap-3 px-2 py-2 group">
      {session.user.image ? (
        <img
          src={session.user.image}
          alt={session.user.name}
          className="w-8 h-8 rounded-full object-cover border border-border"
        />
      ) : (
        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-medium text-sm">
          {session.user.name?.charAt(0).toUpperCase()}
        </div>
      )}
      
      <div className="flex-1 truncate text-sm">
        <div className="font-medium truncate">{session.user.name}</div>
        <div className="text-muted-foreground text-xs truncate">
          {session.user.email}
        </div>
      </div>

      <button
        onClick={async () => {
          await signOut({
            fetchOptions: {
              onSuccess: () => {
                router.push("/login");
              },
            },
          });
        }}
        className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-secondary rounded-md text-muted-foreground hover:text-foreground transition-all"
        title="Log out"
      >
        <LogOut className="w-4 h-4" />
      </button>
    </div>
  );
}
