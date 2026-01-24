# Contributing to TransTrack

Thank you for your interest in contributing to TransTrack! This document provides guidelines for contributing to the project.

## Code of Conduct

Please be respectful and professional in all interactions. We are committed to providing a welcoming environment for everyone.

## Getting Started

### Prerequisites

- Node.js 18 or higher
- npm 9 or higher
- Git

### Development Setup

1. Fork the repository
2. Clone your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/TransTrack.git
   cd TransTrack
   ```

3. Install dependencies:
   ```bash
   npm install
   ```

4. Start development:
   ```bash
   npm run dev:electron
   ```

## Development Guidelines

### Code Style

- Use ESLint for JavaScript/TypeScript linting
- Follow the existing code style
- Use meaningful variable and function names
- Add comments for complex logic

### Commit Messages

Use clear, descriptive commit messages:
- `feat: Add patient export to PDF`
- `fix: Correct priority calculation for kidney patients`
- `docs: Update installation instructions`
- `refactor: Simplify donor matching algorithm`

### Pull Requests

1. Create a feature branch:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. Make your changes
3. Run tests and linting:
   ```bash
   npm run lint
   npm test
   ```

4. Push to your fork:
   ```bash
   git push origin feature/your-feature-name
   ```

5. Create a Pull Request with:
   - Clear description of changes
   - Screenshots if UI changes
   - Any breaking changes noted

## Compliance Considerations

When contributing, please ensure:

1. **No PHI in Code**: Never include real patient data
2. **Audit Logging**: All data modifications must be logged
3. **Access Control**: Respect role-based permissions
4. **Security**: Follow secure coding practices

## Testing

- Write tests for new features
- Ensure existing tests pass
- Test on Windows, macOS, and Linux if possible

## Documentation

- Update documentation for new features
- Include JSDoc comments for functions
- Update the changelog

## Questions?

Open an issue for questions or discussions.

---

Thank you for contributing to TransTrack!
