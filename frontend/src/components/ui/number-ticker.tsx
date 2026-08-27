"use client"

import { useEffect, useRef, type ComponentPropsWithoutRef } from "react"
import { animate, useInView, useMotionValue } from "motion/react"

import { cn } from "@/lib/utils"

/** Hard ceiling on the count-up. A metric must be readable, not watched. */
const MAX_DURATION_S = 1.5

interface NumberTickerProps extends ComponentPropsWithoutRef<"span"> {
  value: number
  startValue?: number
  direction?: "up" | "down"
  delay?: number
  decimalPlaces?: number
  /** Customised: the app shows INR, which groups differently from en-US. */
  locale?: string
  /** Full control over the rendered string (currency symbols, suffixes). */
  format?: (value: number) => string
  /** Seconds for the count-up, clamped to MAX_DURATION_S. */
  duration?: number
}

export function NumberTicker({
  value,
  startValue = 0,
  direction = "up",
  delay = 0,
  className,
  decimalPlaces = 0,
  locale = "en-US",
  format,
  duration = 1.1,
  ...props
}: NumberTickerProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const motionValue = useMotionValue(direction === "down" ? value : startValue)
  const isInView = useInView(ref, { once: true, margin: "0px" })

  // Customised: a tween, not the upstream spring — a spring is asymptotic and overran 5.1s.
  useEffect(() => {
    if (!isInView) return
    const target = direction === "down" ? startValue : value
    const controls = animate(motionValue, target, {
      duration: Math.min(duration, MAX_DURATION_S),
      delay,
      // Fast out of the gate, gentle into the final figure.
      ease: [0.16, 1, 0.3, 1],
    })
    return () => controls.stop()
  }, [motionValue, isInView, delay, value, direction, startValue, duration])

  const render = (n: number) =>
    format
      ? format(n)
      : Intl.NumberFormat(locale, {
          minimumFractionDigits: decimalPlaces,
          maximumFractionDigits: decimalPlaces,
        }).format(n)

  useEffect(
    () =>
      motionValue.on("change", (latest) => {
        if (ref.current) {
          ref.current.textContent = render(Number(latest.toFixed(decimalPlaces)))
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [motionValue, decimalPlaces, locale, format]
  )

  return (
    <span ref={ref} className={cn("inline-block tabular-nums", className)} {...props}>
      {/* Upstream renders the raw startValue, so a metric that never moves (a zero
          P&L) shows "0" rather than a formatted "₹0.00" — format it here too. */}
      {render(startValue)}
    </span>
  )
}
