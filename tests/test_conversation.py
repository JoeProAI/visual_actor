"""Unit tests for the LLM conversation sentence streaming helpers."""

from app.llm.conversation import MAX_SENTENCE_BUFFER, split_complete_sentences


def test_splits_complete_sentences():
    sentences, rest = split_complete_sentences("Hello there. How are you? I am fi")
    assert sentences == ["Hello there.", "How are you?"]
    assert rest == "I am fi"


def test_no_split_without_terminator():
    sentences, rest = split_complete_sentences("still streaming tokens")
    assert sentences == []
    assert rest == "still streaming tokens"


def test_flushes_oversized_buffer():
    long_text = "word " * (MAX_SENTENCE_BUFFER // 4)
    sentences, rest = split_complete_sentences(long_text)
    assert sentences == [long_text.strip()]
    assert rest == ""


def test_handles_quotes_and_ellipsis():
    sentences, rest = split_complete_sentences('She said "go!" Then left… And then')
    assert sentences == ['She said "go!"', "Then left…"]
    assert rest == "And then"
