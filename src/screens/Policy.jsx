import { useApp } from '../store.jsx'
import { FLEX_FEE, FREE_CANCEL_HOURS, GALLERY_RETENTION_DAYS, REFUND_DAYS, money } from '../data.js'
import { Icon, Screen, TopBar, H1 } from '../ui.jsx'

/** The plain-language terms of each rate, shown at checkout and again in the policy. */
export const RATE_TERMS = {
  flexible: (price) => [
    `Cancel at least ${FREE_CANCEL_HOURS} hours before your shoot and get the package price (${money(price)}) back within ${REFUND_DAYS} days.`,
    `The ${money(FLEX_FEE)} flexible-rate fee is never refunded.`,
    `Less than ${FREE_CANCEL_HOURS} hours before the shoot: no refund.`,
    `One free date change, if you ask at least ${FREE_CANCEL_HOURS} hours ahead and your photographer agrees.`,
  ],
  saver: () => [
    'Our lowest price.',
    'If you cancel, there is no refund. Your photographer is paid for holding your date.',
    'Date changes are not available.',
  ],
}

/** Two clear choices, none pre-selected: the client decides. */
export function RatePicker({ price, value, onChange }) {
  const options = [
    { id: 'flexible', title: 'Flexible', cost: price + FLEX_FEE, tag: 'Cancel or move your date', extra: `+${money(FLEX_FEE)}` },
    { id: 'saver', title: 'Saver', cost: price, tag: 'Lowest price, no refunds', extra: null },
  ]
  return (
    <fieldset className="mt-4">
      <legend className="mb-2 text-[14px] font-semibold">Choose your rate</legend>
      <div className="space-y-2.5" role="radiogroup" aria-label="Choose your rate">
        {options.map((o) => {
          const on = value === o.id
          return (
            <button
              key={o.id}
              role="radio"
              aria-checked={on}
              onClick={() => onChange(o.id)}
              className={`block w-full rounded-2xl border-2 p-4 text-left ${on ? 'border-brand bg-cream' : 'border-line bg-white'}`}
            >
              <div className="flex items-start gap-3">
                <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${on ? 'border-ink bg-ink text-white' : 'border-neutral-300'}`}>{on && <Icon.Check size={11} />}</span>
                <div className="flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[15px] font-semibold">{o.title}</span>
                    <span className="font-display text-[18px] font-bold">{money(o.cost)}</span>
                  </div>
                  <div className="text-[12px] text-neutral-500">{o.tag}{o.extra ? ` · ${o.extra}` : ''}</div>
                  {on && (
                    <ul className="mt-2 list-disc space-y-1 pl-4 text-[12.5px] text-neutral-700">
                      {RATE_TERMS[o.id](price).map((t) => <li key={t}>{t}</li>)}
                    </ul>
                  )}
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}

const Section = ({ title, children }) => (
  <section className="mt-6">
    <h2 className="font-display text-[16px] font-bold">{title}</h2>
    <div className="mt-2 space-y-2 text-[13.5px] leading-relaxed text-neutral-700">{children}</div>
  </section>
)

/** Cancellation and refund policy, in plain language. (A South African attorney should review the final Terms.) */
export function Policy() {
  const { back } = useApp()
  return (
    <Screen>
      <TopBar title="Cancellations & refunds" onBack={back} />
      <div className="px-5 pb-8">
        <H1 className="mt-2">Simple, fair<br />and upfront.</H1>
        <p className="mt-2 text-[13px] text-neutral-500">This is a summary in plain language. The full Terms apply.</p>

        <Section title="Your two rates">
          <p><b>Flexible</b> costs {money(FLEX_FEE)} more. If you cancel at least {FREE_CANCEL_HOURS} hours before your shoot, you get the package price back within {REFUND_DAYS} days (the {money(FLEX_FEE)} is not refunded). Less than {FREE_CANCEL_HOURS} hours before: no refund. You also get one free date change, if your photographer agrees.</p>
          <p><b>Saver</b> is the package price. It is our lowest price, with no refund if you cancel and no date changes.</p>
        </Section>
        <Section title="If your photographer cancels or does not show up">
          <p>You get <b>100% of what you paid back</b>, including the flexible-rate fee, within {REFUND_DAYS} days. The photographer receives nothing and gets a strike.</p>
        </Section>
        <Section title="If you do not show up">
          <p>There is no refund. Your photographer held the date and is paid in full.</p>
        </Section>
        <Section title="If there is a problem after the shoot">
          <p>Report it in the app. Our team decides within 5 working days and tells you why in writing. The first payment already released to your photographer is not refundable. If you win, you get back the part that has not been paid out yet. If the photographer wins, they receive the final payment. We can also split the decision.</p>
        </Section>
        <Section title="Your photos and messages">
          <p>Full-size photos are available to download for {GALLERY_RETENTION_DAYS} days after they are approved, then they are deleted. Messages are deleted after 20 days.</p>
        </Section>
        <Section title="Refunds">
          <p>Refunds go back to the payment method you used, within {REFUND_DAYS} days of the decision.</p>
        </Section>
      </div>
    </Screen>
  )
}
