"""PageIdentity 统一解析与兼容字段。"""
from app.utils.page_identity import PageIdentity


def test_from_mapping_parses_conversation_from_url():
    identity = PageIdentity.from_mapping(
        {
            "client_id": "tm-1",
            "page_instance_id": "inst-1",
            "url": "https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        }
    )
    conv_id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    assert identity.client_id == "tm-1"
    assert identity.page_instance_id == "inst-1"
    assert identity.conversation_id == conv_id
    assert identity.has_page_channel()
    assert identity.has_conversation()
    assert identity.display_key() == "inst-1"


def test_to_dict_roundtrip():
    identity = PageIdentity(
        client_id="c1",
        page_instance_id="p1",
        conversation_id="conv",
        url="https://chatgpt.com/c/conv",
    )
    restored = PageIdentity.from_mapping(identity.to_dict())
    assert restored == identity
