# Contributing to MCP OODA Computer

Thank you for your interest in contributing! This document provides guidelines for contributing to this project.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/yourusername/mcp-ooda-computer.git`
3. Install dependencies: `npm install`
4. Create a branch: `git checkout -b feature/your-feature-name`

## Development

### Building

```bash
npm run build
```

### Development Mode

To watch for changes and rebuild automatically:

```bash
npm run dev
```

### Testing

Before submitting a PR, ensure your changes work:

1. Build the project: `npm run build`
2. Test with Claude Desktop by updating your config to point to your local build
3. Test all affected functionality

## Code Style

- Use TypeScript for all code
- Follow the existing code style
- Use meaningful variable and function names
- Add comments for complex logic
- Keep functions focused and small

## Commit Messages

- Use clear, descriptive commit messages
- Start with a verb in present tense (e.g., "Add", "Fix", "Update")
- Reference issue numbers when applicable

Examples:
- `Add support for custom database paths`
- `Fix timeout handling in exec_cli`
- `Update README with new configuration options`

## Pull Request Process

1. Update the README.md with details of changes if applicable
2. Update the CHANGELOG.md with your changes under "Unreleased"
3. Ensure your code builds without errors
4. Test your changes thoroughly
5. Create a pull request with a clear description of the changes

## Security Considerations

This project provides unrestricted CLI access. When contributing:

- Be mindful of security implications
- Document any security-related changes
- Consider the impact on user systems
- Add appropriate warnings for dangerous operations

## Questions?

Feel free to open an issue for:
- Bug reports
- Feature requests
- Questions about the codebase
- Suggestions for improvements

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
