"""Tests for MOA short-hand name resolution."""


from moa_classification.moa_shorthand import (
    group_moa_shorthands,
    resolve_shorthand,
)


class TestResolveShorthand:
    """Test resolve_shorthand with known MOA strings."""

    def test_parp1_inhibitor(self):
        result = resolve_shorthand(
            "Poly [ADP-ribose] polymerase 1 inhibitor",
            action_type="INHIBITOR",
            gene_symbols=["PARP1"],
        )
        assert result.short_form == "PARP1 inhibitor"
        assert result.broad_category == "PARP inhibitor"

    def test_parp2_inhibitor(self):
        result = resolve_shorthand(
            "Poly [ADP-ribose] polymerase 2 inhibitor",
            action_type="INHIBITOR",
            gene_symbols=["PARP2"],
        )
        assert result.short_form == "PARP2 inhibitor"
        assert result.broad_category == "PARP inhibitor"

    def test_egfr_inhibitor(self):
        result = resolve_shorthand(
            "Epidermal growth factor receptor erbB1 inhibitor",
            action_type="INHIBITOR",
            gene_symbols=["EGFR"],
        )
        assert result.short_form == "EGFR inhibitor"
        assert result.broad_category == "EGFR inhibitor"

    def test_vegfr2_inhibitor(self):
        result = resolve_shorthand(
            "Vascular endothelial growth factor receptor 2 inhibitor",
            action_type="INHIBITOR",
        )
        assert result.short_form == "VEGFR2 inhibitor"
        assert result.broad_category == "VEGFR inhibitor"

    def test_cdk4_inhibitor(self):
        result = resolve_shorthand(
            "Cyclin-dependent kinase 4 inhibitor",
            action_type="INHIBITOR",
        )
        assert result.short_form == "CDK4 inhibitor"
        assert result.broad_category == "CDK4/6 inhibitor"

    def test_pdl1_inhibitor(self):
        result = resolve_shorthand(
            "Programmed cell death 1 ligand 1 inhibitor",
            action_type="INHIBITOR",
            gene_symbols=["CD274"],
        )
        assert result.short_form == "PD-L1 inhibitor"
        assert result.broad_category == "Immune Checkpoint inhibitor"

    def test_braf_inhibitor(self):
        result = resolve_shorthand(
            "Serine/threonine-protein kinase B-raf inhibitor",
            action_type="INHIBITOR",
            gene_symbols=["BRAF"],
        )
        assert result.short_form == "BRAF inhibitor"
        assert result.broad_category == "RAF inhibitor"

    def test_gene_symbol_fallback(self):
        """When the curated table has no match, use the gene symbol."""
        result = resolve_shorthand(
            "Some unknown target modulator",
            action_type="MODULATOR",
            gene_symbols=["FGFR2"],
        )
        assert result.short_form == "FGFR2 modulator"
        assert result.broad_category == "FGFR modulator"

    def test_no_match_returns_original(self):
        """With no curated match and no gene symbol, return the original."""
        result = resolve_shorthand(
            "Completely novel target activator",
            action_type="ACTIVATOR",
        )
        assert result.short_form == "Completely novel target activator"
        assert result.broad_category == "Completely novel target activator"

    def test_action_word_extracted_from_moa(self):
        """The action word is extracted from the end of the MOA string."""
        result = resolve_shorthand(
            "Poly [ADP-ribose] polymerase 1 blocker",
        )
        assert result.short_form == "PARP1 blocker"

    def test_mtor_inhibitor(self):
        result = resolve_shorthand(
            "Serine/threonine-protein kinase mTOR inhibitor",
        )
        assert result.short_form == "mTOR inhibitor"
        assert result.broad_category == "mTOR inhibitor"


class TestGroupShorthands:
    """Test grouping of shorthands by broad category."""

    def test_group_parp_family(self):
        shorthands = [
            resolve_shorthand("Poly [ADP-ribose] polymerase 1 inhibitor", gene_symbols=["PARP1"]),
            resolve_shorthand("Poly [ADP-ribose] polymerase 2 inhibitor", gene_symbols=["PARP2"]),
        ]
        groups = group_moa_shorthands(shorthands)
        assert "PARP inhibitor" in groups
        assert "PARP1 inhibitor" in groups["PARP inhibitor"]
        assert "PARP2 inhibitor" in groups["PARP inhibitor"]

    def test_no_duplicates(self):
        shorthands = [
            resolve_shorthand("Poly [ADP-ribose] polymerase 1 inhibitor"),
            resolve_shorthand("Poly [ADP-ribose] polymerase 1 inhibitor"),
        ]
        groups = group_moa_shorthands(shorthands)
        assert len(groups["PARP inhibitor"]) == 1
