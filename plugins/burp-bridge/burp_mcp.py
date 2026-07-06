"""Thin adapter over Burp's MCP server. Isolates the one Burp-specific call."""


class BurpClient:
    def __init__(self, session):  # session: an established MCP client session
        self.session = session

    def history_since(self, cursor):
        # Burp's MCP exposes proxy history as a tool; call it and normalize rows to the
        # dict shape poll_once expects. Returns (rows, new_cursor).
        result = self.session.call_tool("get_proxy_history", {"since": cursor})
        rows = [_normalize(item) for item in result]
        new_cursor = rows[-1]["_seq"] if rows else cursor
        return rows, new_cursor


def _normalize(item):
    return {
        "pair_id": str(item["id"]), "_seq": item["id"], "host": item.get("host"),
        "method": item.get("method", "GET"), "url": item.get("url", ""),
        "req_headers": item.get("request_headers", ""), "req_body": item.get("request_body", ""),
        "status": item.get("status_code", 0), "resp_headers": item.get("response_headers", ""),
        "resp_body": item.get("response_body", ""), "mime": item.get("mime_type", ""),
    }
