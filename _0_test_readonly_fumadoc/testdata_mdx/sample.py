def greet(name: str) -> str:
    """non-md files are displayed as a code block, language chosen by suffix."""
    return f"hello, {name}"


if __name__ == "__main__":
    print(greet("doc system"))
