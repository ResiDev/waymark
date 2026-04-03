import { TutorialStep } from './types';

export type TutorialPlacement = 'top' | 'bottom' | 'left' | 'right';

// export const ONBOARDING_STEPS: Array<TutorialStep> = [
//   {
//     highlightName: 'create-deck',
//     text: "Let's start by creating your first deck. Click here to get started!",
//     route: 'decks',
//   },
//   {
//     id: 'open-deck',
//     text: 'Nice! Now open your new deck to add some cards.',
//     placement: 'bottom',
//     route: 'decks',
//     waitForInteraction: true,
//   },
//   {
//     id: 'add-cards',
//     text: 'Paste or type some text here and the AI will create flashcards for you. Or write your own!',
//     placement: 'right',
//     route: 'create',
//     waitForInteraction: true,
//   },
//   {
//     id: 'start-review',
//     text: "Great, you've got cards! Let's try reviewing them. Head to review!",
//     placement: 'bottom',
//     route: 'review',
//     waitForInteraction: true,
//   },
//   {
//     id: 'flip-card',
//     text: 'Click the card to flip it and see the answer.',
//     placement: 'left',
//     route: 'review',
//     waitForInteraction: true,
//   },
//   {
//     id: 'rate-card',
//     text: 'How well did you remember? Rate yourself to schedule the next review.',
//     placement: 'top',
//     route: 'review',
//   },
// ];
