import { useEffect, useState } from 'react'

interface ReviewItem {
  id: number
  file_path: string
  question: string
  answer: string
  repetitions: number
  easiness: number
  interval: number
  due_date: string
}

interface ReviewPageProps {
  backendUrl: string
  onBack?: () => void
}

const QUALITY_LABELS: Record<number, string> = {
  0: 'Blackout',
  1: 'Wrong',
  2: 'Hard',
  3: 'Good',
  4: 'Easy',
}

export default function ReviewPage({ backendUrl, onBack }: ReviewPageProps) {
  const [items, setItems] = useState<ReviewItem[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [showAnswer, setShowAnswer] = useState(false)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [aiSummary, setAiSummary] = useState<string | null>(null)
  const [loadingSummary, setLoadingSummary] = useState(false)
  const [summaryVisible, setSummaryVisible] = useState(false)

  useEffect(() => {
    fetch(`${backendUrl}/review/due`)
      .then((r) => r.json())
      .then((data: ReviewItem[]) => {
        setItems(data)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [backendUrl])

  const currentItem = items[currentIndex]
  const isDone = !loading && currentIndex >= items.length

  const handleQuality = async (quality: number) => {
    if (!currentItem || submitting) return
    setSubmitting(true)
    try {
      await fetch(`${backendUrl}/review/record`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: currentItem.id, quality }),
      })
    } finally {
      setSubmitting(false)
      setShowAnswer(false)
      setAiSummary(null)
      setSummaryVisible(false)
      setCurrentIndex((i) => i + 1)
    }
  }

  const handleShowSummary = async () => {
    if (!currentItem) return
    setSummaryVisible(true)
    setLoadingSummary(true)
    try {
      const resp = await fetch(`${backendUrl}/summary/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_path: currentItem.file_path }),
      })
      if (resp.ok) {
        const data = await resp.json()
        setAiSummary(data.summary)
      } else {
        setAiSummary('Summary not available for this file.')
      }
    } catch {
      setAiSummary('Failed to load summary.')
    } finally {
      setLoadingSummary(false)
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-3 border-b px-6 py-4">
        <button
          data-testid="review-back-button"
          onClick={onBack}
          className="rounded px-2 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          ← Back
        </button>
        <h1 className="text-xl font-semibold">Review</h1>
        {!loading && (
          <span data-testid="review-progress" className="ml-auto text-sm text-muted-foreground">
            {Math.min(currentIndex, items.length)} / {items.length}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col items-center justify-center px-6 py-8">
        {loading && (
          <p className="text-muted-foreground">Loading review items...</p>
        )}

        {isDone && (
          <div data-testid="review-complete" className="text-center">
            <p className="text-2xl font-semibold text-green-600">All done! 🎉</p>
            <p className="mt-2 text-muted-foreground">
              {items.length === 0 ? 'No items due for review today.' : `You reviewed ${items.length} items.`}
            </p>
          </div>
        )}

        {!loading && !isDone && currentItem && (
          <div className="w-full max-w-xl">
            {/* Card */}
            <div className="rounded-xl border bg-card p-8 shadow-md">
              <p className="text-lg font-medium">{currentItem.question}</p>

              {showAnswer && (
                <div className="mt-6 border-t pt-4">
                  <p className="text-base text-foreground">{currentItem.answer}</p>
                </div>
              )}

              {summaryVisible && (
                <div className="mt-4 rounded-md bg-secondary/50 p-3">
                  <p className="mb-1 text-xs font-semibold text-muted-foreground">AI Summary</p>
                  {loadingSummary ? (
                    <p className="text-sm text-muted-foreground">Loading summary...</p>
                  ) : (
                    <p data-testid="ai-summary" className="text-sm">
                      {aiSummary}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Controls */}
            <div className="mt-6 flex flex-col items-center gap-4">
              {!showAnswer ? (
                <button
                  data-testid="show-answer-button"
                  onClick={() => setShowAnswer(true)}
                  className="rounded-md bg-primary px-6 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
                >
                  Show Answer
                </button>
              ) : (
                <>
                  {!summaryVisible && (
                    <button
                      data-testid="show-summary-button"
                      onClick={handleShowSummary}
                      className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                    >
                      Show AI Summary
                    </button>
                  )}
                  <div className="flex flex-wrap justify-center gap-2">
                    {[0, 1, 2, 3, 4].map((q) => (
                      <button
                        key={q}
                        data-testid={`quality-button-${q}`}
                        onClick={() => handleQuality(q)}
                        disabled={submitting}
                        className={`rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50 ${
                          q <= 1
                            ? 'bg-red-500 text-white hover:bg-red-600'
                            : q === 2
                            ? 'bg-yellow-500 text-white hover:bg-yellow-600'
                            : q === 3
                            ? 'bg-blue-500 text-white hover:bg-blue-600'
                            : 'bg-green-500 text-white hover:bg-green-600'
                        }`}
                      >
                        {QUALITY_LABELS[q]}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
