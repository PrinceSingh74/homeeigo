import Link from "next/link";

type AuthFooterLinkProps = {
  prompt: string;
  href: string;
  label: string;
};

export function AuthFooterLink({ prompt, href, label }: AuthFooterLinkProps) {
  return (
    <p>
      {prompt}{" "}
      <Link href={href} className="font-semibold text-primary hover:text-primary/80">
        {label}
      </Link>
    </p>
  );
}
