# SmartMart — Project Rules

## Project Overview
SmartMart is a supermarket Inventory & Delivery Management System. The first milestone is a clickable frontend prototype.

## Technologies
- HTML
- CSS
- JavaScript
- Browser localStorage for prototype persistence where appropriate
- No frontend frameworks or backend in the first review

## Team Responsibilities
- Member 1: Inventory management
- Member 2: Orders and delivery management
- Member 3: Dashboard, login and shared UI

## Design System
- Primary: #166534
- Accent: #22C55E
- Background: #F8FAFC
- Surface: #FFFFFF
- Text: #1F2937
- Secondary text: #64748B
- Border: #E2E8F0
- Success: #15803D
- Warning: #F59E0B
- Danger: #DC2626
- Font: Inter

## Product Data Contract
Every product must use:
- id: number
- name: string
- category: string
- price: number
- stock: number

## Order Data Contract
Every order must use:
- id: number
- customerName: string
- items: array
- total: number
- status: string

## Order Statuses
Use these exact values:
- Pending
- Processing
- Dispatched
- Delivered
- Cancelled

## Coding Rules
1. Use consistent naming across all modules.
2. Do not rename shared data fields or status values.
3. Do not create duplicate shared product or order datasets.
4. Use shared CSS variables and components.
5. Do not overwrite another member's files without team agreement.
6. All visible buttons and forms must have working prototype behaviour.
7. Use fictional sample data.
8. Explain any new shared function or dependency before introducing it.
9. Check existing shared files before generating code that depends on them.
10. Coordinate shared-file changes through GitHub pull requests.

## Prototype Limitations
This is a frontend demonstration, not a production application. Login is a demo interaction and must not be presented as secure authentication. No real customer information or credentials should be used.