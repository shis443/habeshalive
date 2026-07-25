import { Suspense } from "react";
import { LoginForm } from "@/components/LoginForm";

export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm mode="signup" />
    </Suspense>
  );
}
