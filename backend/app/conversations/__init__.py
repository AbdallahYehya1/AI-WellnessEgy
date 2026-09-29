"""Conversations: conversation and message records.

Messages must go through the safety-gated pipeline. They must never go
straight from request to LLM (see docs/ARCHITECTURE.md).

Milestone 1: module boundary only. No implementation yet.
"""
