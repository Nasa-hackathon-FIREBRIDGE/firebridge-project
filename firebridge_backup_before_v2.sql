--
-- PostgreSQL database dump
--

-- Dumped from database version 16.4 (Debian 16.4-1.pgdg110+2)
-- Dumped by pg_dump version 16.4 (Debian 16.4-1.pgdg110+2)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: firebridge; Type: SCHEMA; Schema: -; Owner: firebridge
--

CREATE SCHEMA firebridge;


ALTER SCHEMA firebridge OWNER TO firebridge;

--
-- Name: tiger; Type: SCHEMA; Schema: -; Owner: firebridge
--

CREATE SCHEMA tiger;


ALTER SCHEMA tiger OWNER TO firebridge;

--
-- Name: tiger_data; Type: SCHEMA; Schema: -; Owner: firebridge
--

CREATE SCHEMA tiger_data;


ALTER SCHEMA tiger_data OWNER TO firebridge;

--
-- Name: topology; Type: SCHEMA; Schema: -; Owner: firebridge
--

CREATE SCHEMA topology;


ALTER SCHEMA topology OWNER TO firebridge;

--
-- Name: SCHEMA topology; Type: COMMENT; Schema: -; Owner: firebridge
--

COMMENT ON SCHEMA topology IS 'PostGIS Topology schema';


--
-- Name: fuzzystrmatch; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS fuzzystrmatch WITH SCHEMA public;


--
-- Name: EXTENSION fuzzystrmatch; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION fuzzystrmatch IS 'determine similarities and distance between strings';


--
-- Name: postgis; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;


--
-- Name: EXTENSION postgis; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION postgis IS 'PostGIS geometry and geography spatial types and functions';


--
-- Name: postgis_tiger_geocoder; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS postgis_tiger_geocoder WITH SCHEMA tiger;


--
-- Name: EXTENSION postgis_tiger_geocoder; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION postgis_tiger_geocoder IS 'PostGIS tiger geocoder and reverse geocoder';


--
-- Name: postgis_topology; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS postgis_topology WITH SCHEMA topology;


--
-- Name: EXTENSION postgis_topology; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION postgis_topology IS 'PostGIS topology spatial types and functions';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: sources; Type: TABLE; Schema: firebridge; Owner: firebridge
--

CREATE TABLE firebridge.sources (
    id text NOT NULL,
    name text NOT NULL,
    provider text NOT NULL,
    kind text NOT NULL,
    platform text,
    instrument text,
    product text NOT NULL,
    collection text NOT NULL,
    processing_stream text NOT NULL,
    documentation_url text NOT NULL,
    citation text NOT NULL,
    license_info text NOT NULL,
    native_resolution_m double precision,
    schema_version text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT sources_documentation_url_check CHECK ((documentation_url ~ '^https?://'::text)),
    CONSTRAINT sources_kind_check CHECK ((kind = ANY (ARRAY['hotspots'::text, 'fire_mask'::text, 'geolocation'::text, 'land_cover'::text, 'imagery'::text, 'weather'::text, 'news'::text, 'incident_report'::text]))),
    CONSTRAINT sources_native_resolution_m_check CHECK (((native_resolution_m IS NULL) OR (native_resolution_m > (0)::double precision)))
);


ALTER TABLE firebridge.sources OWNER TO firebridge;

--
-- Name: HealthCheck; Type: TABLE; Schema: public; Owner: firebridge
--

CREATE TABLE public."HealthCheck" (
    id text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    status text NOT NULL
);


ALTER TABLE public."HealthCheck" OWNER TO firebridge;

--
-- Name: _prisma_migrations; Type: TABLE; Schema: public; Owner: firebridge
--

CREATE TABLE public._prisma_migrations (
    id character varying(36) NOT NULL,
    checksum character varying(64) NOT NULL,
    finished_at timestamp with time zone,
    migration_name character varying(255) NOT NULL,
    logs text,
    rolled_back_at timestamp with time zone,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    applied_steps_count integer DEFAULT 0 NOT NULL
);


ALTER TABLE public._prisma_migrations OWNER TO firebridge;

--
-- Data for Name: sources; Type: TABLE DATA; Schema: firebridge; Owner: firebridge
--

COPY firebridge.sources (id, name, provider, kind, platform, instrument, product, collection, processing_stream, documentation_url, citation, license_info, native_resolution_m, schema_version, metadata) FROM stdin;
ff7d2c50-7d29-440b-bb5f-8f6229a965b7	VIIRS active fire	NASA	hotspots	\N	\N	VNP14IMG	2	near-real-time	https://example.org/source	Example source citation	Open data	\N	1	{}
\.


--
-- Data for Name: HealthCheck; Type: TABLE DATA; Schema: public; Owner: firebridge
--

COPY public."HealthCheck" (id, "createdAt", status) FROM stdin;
\.


--
-- Data for Name: _prisma_migrations; Type: TABLE DATA; Schema: public; Owner: firebridge
--

COPY public._prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) FROM stdin;
4be6d38a-28f7-44d8-92ff-bbe27afd3776	418ada3b88ee99f001a5e10e841b37205e2d630fc4dd16a285ddc1d5d70445e1	2026-10-29 00:52:41.021287+00	20261029005240_firebridge_initial_schema	\N	\N	2026-10-29 00:52:40.996155+00	1
715dbb28-64cd-40ed-9b2f-faaa72eeac65	2806aa56c671c2cb958750b06ee6bcc49a0c3676ea53deff56ec9c068d636e81	2026-10-29 04:09:57.670111+00	20261029030000_add_sources	\N	\N	2026-10-29 04:09:57.544971+00	1
\.


--
-- Data for Name: spatial_ref_sys; Type: TABLE DATA; Schema: public; Owner: firebridge
--

COPY public.spatial_ref_sys (srid, auth_name, auth_srid, srtext, proj4text) FROM stdin;
\.


--
-- Data for Name: geocode_settings; Type: TABLE DATA; Schema: tiger; Owner: firebridge
--

COPY tiger.geocode_settings (name, setting, unit, category, short_desc) FROM stdin;
\.


--
-- Data for Name: pagc_gaz; Type: TABLE DATA; Schema: tiger; Owner: firebridge
--

COPY tiger.pagc_gaz (id, seq, word, stdword, token, is_custom) FROM stdin;
\.


--
-- Data for Name: pagc_lex; Type: TABLE DATA; Schema: tiger; Owner: firebridge
--

COPY tiger.pagc_lex (id, seq, word, stdword, token, is_custom) FROM stdin;
\.


--
-- Data for Name: pagc_rules; Type: TABLE DATA; Schema: tiger; Owner: firebridge
--

COPY tiger.pagc_rules (id, rule, is_custom) FROM stdin;
\.


--
-- Data for Name: topology; Type: TABLE DATA; Schema: topology; Owner: firebridge
--

COPY topology.topology (id, name, srid, "precision", hasz) FROM stdin;
\.


--
-- Data for Name: layer; Type: TABLE DATA; Schema: topology; Owner: firebridge
--

COPY topology.layer (topology_id, layer_id, schema_name, table_name, feature_column, feature_type, level, child_id) FROM stdin;
\.


--
-- Name: topology_id_seq; Type: SEQUENCE SET; Schema: topology; Owner: firebridge
--

SELECT pg_catalog.setval('topology.topology_id_seq', 1, false);


--
-- Name: sources sources_pkey; Type: CONSTRAINT; Schema: firebridge; Owner: firebridge
--

ALTER TABLE ONLY firebridge.sources
    ADD CONSTRAINT sources_pkey PRIMARY KEY (id);


--
-- Name: HealthCheck HealthCheck_pkey; Type: CONSTRAINT; Schema: public; Owner: firebridge
--

ALTER TABLE ONLY public."HealthCheck"
    ADD CONSTRAINT "HealthCheck_pkey" PRIMARY KEY (id);


--
-- Name: _prisma_migrations _prisma_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: firebridge
--

ALTER TABLE ONLY public._prisma_migrations
    ADD CONSTRAINT _prisma_migrations_pkey PRIMARY KEY (id);


--
-- Name: sources_kind_idx; Type: INDEX; Schema: firebridge; Owner: firebridge
--

CREATE INDEX sources_kind_idx ON firebridge.sources USING btree (kind);


--
-- Name: sources_provider_idx; Type: INDEX; Schema: firebridge; Owner: firebridge
--

CREATE INDEX sources_provider_idx ON firebridge.sources USING btree (provider);


--
-- PostgreSQL database dump complete
--

