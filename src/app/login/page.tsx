"use client"

import * as React from "react"
import Image from "next/image"
import Link from "next/link"
import { Eye, EyeOff, X } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ClearableInput } from "@/components/ui/clearable-input"
import {
  Sheet,
  SheetContent,
  SheetClose,
} from "@/components/ui/sheet"

// Simple email validation
const isValidEmail = (email: string) => {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export default function LoginPage() {
  const [sheetOpen, setSheetOpen] = React.useState(false)
  const [showPassword, setShowPassword] = React.useState(false)
  const [email, setEmail] = React.useState("")
  const [password, setPassword] = React.useState("")

  // Form validation
  const emailValid = isValidEmail(email)
  const passwordValid = password.length >= 1
  const canSubmit = emailValid && passwordValid

  const handleSignIn = (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    // TODO: Implement actual sign in logic
    console.log("Sign in attempt:", { email, password })
  }

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden">
      {/* Blurred logo background image - light mode */}
      <Image
        src="/bkg.png"
        alt=""
        fill
        className="object-cover dark:hidden"
        aria-hidden="true"
        priority
      />
      {/* Blurred logo background image - dark mode */}
      <Image
        src="/bkg-inv.png"
        alt=""
        fill
        className="object-cover hidden dark:block"
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
        <SheetContent side="right" className="w-full sm:max-w-md flex flex-col">
          {/* Close button stays at top */}
          <SheetClose className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-secondary">
            <X className="size-4" />
            <span className="sr-only">Close</span>
          </SheetClose>

          {/* Content pushed down with top padding */}
          <div className="flex flex-col pt-12">
            {/* Logo in sheet - aligned left */}
            <div className="flex items-center gap-2 px-4">
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
            
            {/* Content Simplified - aligned with Abluo text */}
            <div className="mt-1 px-4 pl-[52px]">
              <span className="text-xs text-muted-foreground">Content Simplified</span>
            </div>

            {/* Sign in title - with spacing from logo section */}
            <div className="mt-8 px-4">
              <h2 className="text-xl font-semibold">Sign in to Abluo</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Enter your credentials to access your account.
              </p>
            </div>

            {/* Sign In Form - with spacing from title */}
            <form onSubmit={handleSignIn} className="mt-6 flex flex-col gap-5 px-4">
              {/* Email Field with clearable input */}
              <div className="flex flex-col gap-2">
                <label
                  htmlFor="email"
                  className="text-sm font-medium text-foreground"
                >
                  Email address
                </label>
                <ClearableInput
                  id="email"
                  type="email"
                  placeholder="Enter your email address"
                  value={email}
                  onChange={setEmail}
                  clearThreshold={3}
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
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
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

              {/* Forgot Password Link - reduced emphasis */}
              <div className="flex justify-end">
                <Link
                  href="/forgot-password"
                  className="text-xs text-muted-foreground/70 hover:text-muted-foreground hover:underline"
                >
                  Forgot your password?
                </Link>
              </div>

              {/* Sign In Button - disabled until valid */}
              <Button 
                type="submit" 
                size="lg" 
                className="w-full"
                disabled={!canSubmit}
              >
                Sign In
              </Button>

              {/* Footer Links */}
              <div className="flex flex-col items-center gap-3 pt-4 text-center text-sm">
                <p className="text-muted-foreground">
                  New to Abluo?{" "}
                  <Link
                    href="/register"
                    className="font-medium text-foreground hover:underline"
                  >
                    Create an Account
                  </Link>
                </p>
                <p className="text-muted-foreground">
                  Need help?{" "}
                  <Link
                    href="/contact"
                    className="font-medium text-foreground hover:underline"
                  >
                    Contact Abluo
                  </Link>
                </p>
              </div>
            </form>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
