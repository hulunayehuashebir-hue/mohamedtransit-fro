import { redirect } from "next/navigation";

export default function UnlocalizedLoginPage() {
  redirect("/en/auth/login");
}
