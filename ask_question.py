import sys

def ask_question(question):
    print(f"QUESTION: {question}")

if __name__ == "__main__":
    if len(sys.argv) > 1:
        ask_question(" ".join(sys.argv[1:]))
