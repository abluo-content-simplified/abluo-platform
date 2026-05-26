"use client"

import * as React from "react"
import Image from "next/image"
import Link from "next/link"
import { Eye, EyeOff } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet"

export default function LoginPage() {
  const [sheetOpen, setSheetOpen] = React.useState(false)
  const [showPassword, setShowPassword] = React.useState(false)
  const [email, setEmail] = React.useState("")
  const [password, setPassword] = React.useState("")

  const handleSignIn = (e: React.FormEvent) => {
    e.preventDefault()
    // TODO: Implement actual sign in logic
    console.log("Sign in attempt:", { email, password })
  }

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden">
      {/* Blurred logo background image */}
      <Image
        src="/bkg.png"
        alt=""
        fill
        className="object-cover"
        aria-hidden="true"
        priority
      />

      {/* Centered content - above background */}
      <div className="relative z-10 flex flex-col items-center gap-8 px-4">
        {/* Logo */}
        <div className="flex items-center gap-2">
          <Image
            src="/logo.svg"
            alt="Abluo"
            width={48}
            height={48}
            className="size-12"
          />
          <Image
            src="/abluo.svg"
            alt="Abluo"
            width={120}
            height={32}
            className="h-8 w-auto dark:hidden"
          />
          <Image
            src="/abluo-inv.svg"
            alt="Abluo"
            width={120}
            height={32}
            className="hidden h-8 w-auto dark:block"
          />
        </div>

        {/* Welcome text */}
        <div className="flex flex-col items-center gap-2 text-center">
          <h1 className="text-2xl font-semibold text-foreground">
            Welcome to Abluo
          </h1>
          <p className="text-muted-foreground">
            Manage your website content.
          </p>
        </div>

        {/* Actions */}
        <div className="flex flex-col items-center gap-3">
          <Button
            size="lg"
            className="w-48"
            onClick={() => setSheetOpen(true)}
          >
            Sign In
          </Button>
          <Link
            href="/register"
            className="text-sm text-muted-foreground hover:text-foreground hover:underline"
          >
            Create Account
          </Link>
        </div>
      </div>

      {/* Sign In Sheet/Side Panel */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader className="gap-4 pb-6">
            {/* Logo in sheet */}
            <div className="flex items-center gap-2">
              <Image
                src="/logo.svg"
                alt="Abluo"
                width={32}
                height={32}
                className="size-8"
              />
              <Image
                src="/abluo.svg"
                alt="Abluo"
                width={80}
                height={24}
                className="h-5 w-auto dark:hidden"
              />
              <Image
                src="/abluo-inv.svg"
                alt="Abluo"
                width={80}
                height={24}
                className="hidden h-5 w-auto dark:block"
              />
            </div>
            <div>
              <SheetTitle className="text-xl">Sign in to Abluo</SheetTitle>
              <SheetDescription>
                Enter your credentials to access your account.
              </SheetDescription>
            </div>
          </SheetHeader>

          {/* Sign In Form */}
          <form onSubmit={handleSignIn} className="flex flex-col gap-5 px-4">
            {/* Email Field */}
            <div className="flex flex-col gap-2">
              <label
                htmlFor="email"
                className="text-sm font-medium text-foreground"
              >
                Email address
              </label>
              <Input
                id="email"
                type="email"
                placeholder="Enter your email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="h-10"
              />
            </div>

            {/* Password Field */}
            <div className="flex flex-col gap-2">
              <label
                htmlFor="password"
                className="text-sm font-medium text-foreground"
              >
                Password
              </label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="h-10 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? (
                    <EyeOff className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                </button>
              </div>
            </div>

            {/* Forgot Password Link */}
            <div className="flex justify-end">
              <Link
                href="/forgot-password"
                className="text-sm text-muted-foreground hover:text-foreground hover:underline"
              >
                Forgot your password?
              </Link>
            </div>

            {/* Sign In Button */}
            <Button type="submit" size="lg" className="w-full">
              Sign In
            </Button>

            {/* Footer Links */}
            <div className="flex flex-col items-center gap-3 pt-4 text-center text-sm">
              <p className="text-muted-foreground">
                New on Abluo?{" "}
                <Link
                  href="/register"
                  className="font-medium text-foreground hover:underline"
                >
                  Create an account
                </Link>
              </p>
              <div className="flex items-center gap-3 text-muted-foreground">
                <Link
                  href="/contact"
                  className="hover:text-foreground hover:underline"
                >
                  Contact us
                </Link>
                <span className="text-border">|</span>
                <Link
                  href="/about"
                  className="hover:text-foreground hover:underline"
                >
                  Contact Abluo
                </Link>
              </div>
            </div>
          </form>
        </SheetContent>
      </Sheet>
    </div>
  )
}
