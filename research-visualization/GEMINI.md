# Project Context: Research Visualization (AlphaQubit)

## Overview
This project is a React-based interactive landing page/visualization for the "AlphaQubit" research paper ("Learning high-accuracy error decoding for quantum processors", Nature 2024). It uses high-fidelity 3D graphics (Three.js) and clean UI (Tailwind CSS) to explain complex quantum computing concepts like surface codes and neural network decoding.

## Tech Stack
*   **Framework:** React 19 + Vite
*   **Language:** TypeScript
*   **Styling:** Tailwind CSS (inferred from utility classes in `App.tsx`)
*   **3D Graphics:** Three.js, `@react-three/fiber`, `@react-three/drei`
*   **Animation:** Framer Motion
*   **Icons:** Lucide React

## Project Structure
*   `App.tsx`: Main application component containing the single-page layout (Hero, Introduction, Science, Impact, Authors).
*   `components/`: Contains sub-components for visualizations.
    *   `QuantumScene.tsx`: 3D scenes using React Three Fiber (e.g., `HeroScene` with floating particles, `QuantumComputerScene` simulating a cryostat).
    *   `Diagrams.tsx`: (Inferred) 2D diagrams or specific visualizations for "Surface Code", "Transformer Decoder", etc.
*   `types.ts`: TypeScript definitions for data structures.

## Development

### Prerequisites
*   Node.js
*   Gemini API Key (set in `.env.local` as `GEMINI_API_KEY`)

### Key Commands
*   **Install Dependencies:** `npm install`
*   **Start Development Server:** `npm run dev` (Runs Vite)
*   **Build for Production:** `npm run build`
*   **Preview Build:** `npm run preview`

### Design System
*   **Theme:** "Nobel Gold" (`#C5A059`) and "Stone" (grays/whites) to evoke a premium, scientific feel (Nature journal aesthetic).
*   **Typography:** Serif fonts for headings (likely configured in Tailwind config), Sans-serif for body text.
*   **Components:** Functional components using Hooks (`useState`, `useEffect`, `useRef`).

## Contextual Notes
*   The application is designed to be visually rich ("App" container has `min-h-screen`, `bg-[#F9F8F4]`).
*   It includes a custom navigation bar that reacts to scroll (`scrolled` state).
*   External link to the DOI is prominent.
